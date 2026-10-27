# Development

## First checkout

Install Mise on macOS or Linux:

```sh
curl https://mise.run | sh
```

On Windows:

```powershell
winget install jdx.mise
```

Then, from the repository root:

```sh
export PATH="$HOME/.local/bin:$PATH"
mise install
mise exec -- vp i
mise exec -- vp run dev
```

The commands below use bare `vp`; activate Mise in your shell, or prefix each
command with `mise exec --`.

Open the pairing URL printed by the dev runner. The bare origin does not authenticate
a new browser.

Prefer a container? See [Dev container](../internals/devcontainer.md) for VS Code and Codespaces setup.

## Choosing a dev process

Use `vp run dev` for server and web, or `vp run dev:desktop` for the Electron client.
`dev:server` and `dev:web` start those processes separately.
See the [mobile README](../../apps/mobile/README.md) for native builds and Metro.

macOS desktop development and iOS builds require full Xcode 27 or newer. Select its developer
directory with `DEVELOPER_DIR` or `xcode-select`; the Command Line Tools alone cannot compile the
layered app icon. Native CI builds select Xcode 27.1 on the `xcode-27` preview runner image,
preserving the iOS 27.1 SDK required for Duo support.

Flags go directly after the task name, for example `vp run dev --home-dir /tmp/supaterm-dev`.
Add `--browser` to open a browser automatically.

### State and ports

Linked worktrees default to their own `.supaterm/userdata`, even when `SUPATERM_HOME` is set.
The main checkout defaults to `~/.supaterm/dev/userdata`. An explicit `--home-dir` wins in both cases.
Never run a development server against the live `~/.supaterm/userdata`.
See [test data](../../AGENTS.md#test-data) for copying a consistent database snapshot.

Read ports from the `[dev-runner]` output. Worktrees derive stable preferences from their paths,
but occupied ports can shift them. `SUPATERM_PORT_OFFSET` or `SUPATERM_DEV_INSTANCE` can select a
different preference when needed.

### Sharing and remote debugging

`vp run dev --share` publishes the web port over the machine's tailnet and prints a pairing URL
for that origin. Give the tester the complete URL, including its token. The dev runner removes
its mapping on exit.

Leave `VITE_HTTP_URL` and `VITE_WS_URL` unset. Vite proxies the backend through the browser's
origin so the same build works over localhost and remote connections.

Shared runs enable bundled dev to avoid a network round trip for each import level.
`SUPATERM_BUNDLED_DEV=0` opts out when debugging bundler differences. Two reload traps matter
when changing this setup:

- The web entry must dynamically import the app so React refresh initializes before application
  chunks. Static imports can work on first load and fail after a route split.
- Bundled dev rebuilds Tailwind through watched files. Its ordinary Vite hot-update hook expects
  a server/module graph that Rolldown does not provide.
- The app and its routes are lazy chunks, built on first request. A plugin pre-bundles the
  startup chain when the server starts. Renaming or moving a startup route or the app entry
  silently drops it from that list.

The workarounds live in the [web entry](../../apps/web/src/bootstrap.ts),
[Tailwind plugin](../../apps/web/vite/tailwind.ts), and
[startup warmup](../../apps/web/vite/warmBundledDev.ts).

`vp run dev --share --built` skips the Vite dev server. It runs `vp build --watch` for the web
app, and the backend serves `apps/web/dist` on the same tailnet URL and pairing flow. Use it when
someone tests over a slow link or only needs to use the app: loads are production size, and the
first load does not wait for dev bundling. There is no HMR. After an edit, wait for the
`built in` line (about 6 s), then reload. Until the first build exists, the URL shows a page that
reloads by itself. The license manifest is not generated in this mode. `--built` requires
`--share` and the `dev` mode.

#### Reusable dev credential

Use this only on a hostname where you trust every service. Browsers send cookies to all ports
on that hostname. Any service you visit there can receive the reusable admin credential,
including services unrelated to Supaterm. If you run untrusted services on that hostname, keep
normal per-environment pairing instead.

To use one browser profile across web dev worktrees on the same hostname, generate one fixed
value once:

```sh
openssl rand -hex 32
```

Put that value in the main checkout's gitignored `.env`:

```dotenv
SUPATERM_DEV_AUTH_TOKEN=<the value generated above>
```

The `supaterm.json` Setup Worktree action links that file to each worktree's `.env`. The dev runner reads repository env files at startup. `.env.local` and inherited process
environment values override `.env`, so no per-worktree export is needed after setup.

For a manual worktree or launcher without that link, export the same fixed value instead:

```sh
export SUPATERM_DEV_AUTH_TOKEN="<the value generated above>"
```

Do not generate a new value at startup. Start or restart `vp run dev --share` after configuration,
then open its printed startup pairing URL once per browser profile on that hostname. Later web dev
servers on the same hostname accept the shared cookie across ports. The cookie expires after 30
days. Reload an old tab if its URL now serves a replacement environment.

The token and startup pairing URLs are reusable administrative secrets. Never put them in a
commit, pull request, or public output. Every server still seeds its own auth database record at
startup and keeps its own SQLite data, signing key, and revocation state. Desktop and non-dev
servers ignore the value. See [environment authentication](../internals/environment-auth.md#reusable-dev-credential)
for the security model.

## Icons

Web, desktop, Android, the marketing site, and the project icon picker draw icons from
`@supaterm/icons` (`packages/icons`). iOS and macOS native menus use SF Symbols. Surfaces outside
React (sprites, injected pages, canvas, rasterized assets) render the same glyphs with
`iconSvgElements` from `@supaterm/icons/nodes`. The glyphs are vendored from
[Central Icons](https://iconists.co/central) (`round-outlined-radius-2-stroke-2`), which is paid
and licensed only for use in Supaterm; see `packages/icons/LICENSE.md`.

Use an existing export when one fits. To add or swap a glyph, add the export name and its Central
icon to `packages/icons/icons.json` (`project` lists the picker's icons), then regenerate:

```sh
vp run --filter @supaterm/icons sync
```

The sync needs the license key. fnox reads `CENTRAL_LICENSE_KEY` from the `Supacode Next Central
Icons` item in the `Supacode Next CI` 1Password vault (the `central-icons` profile in
[`.github/fnox.toml`](../../.github/fnox.toml)), so sign in to the 1Password CLI (`op`) with access
to that vault first. Commit `icons.json` with the regenerated `src/generated/` files. Contributors
without vault access can ask a maintainer to add the icon. Never commit the key.

## Checks

`vp run check:changed` runs CI's fast checks for your branch's changes: format and lint of the
changed files, `knip:check` when code or a manifest changes, the generated GraphQL checks, typecheck
of the affected packages and their dependents, and the test files beside the changed files. It maps
files to packages with [changed-packages.ts](../../scripts/lib/changed-packages.ts) and compares
against the merge base with `origin/main`, or with a ref you pass. A changed `package.json` or a path
the mapping does not recognize affects every package. CI still runs the full test suites and the
jobs the summary lists, so a local pass does not promise a green CI run.

While you iterate, run single checks:

```sh
vp test run <files>
vp lint <files>
vp run --filter <package> typecheck
```

In `apps/web`, a test that renders React or touches the DOM is named `*.browser.test.{ts,tsx}`
and runs in headless Chromium with the React Compiler on, like the app. There is no jsdom; other
`*.test.ts` files run in Node. Install the browser once with
`node apps/web/node_modules/playwright/cli.js install --only-shell chromium`.

TypeScript workspaces typecheck with `tsc`. The `typescript` catalog entry is
`@tsc-rs/typescript`, the tsc-rs drop-in, with Effect diagnostics, quick fixes, and
refactors built in. VS Code uses it through `js/ts.tsdk.path` in `.vscode/settings.json`.
Marketing keeps `astro check` for Astro files.

Use `vp run lint:mobile` for native mobile changes. CI owns the full suite; see
[ci.yml](../../.github/workflows/ci.yml) for its current jobs.
The [manual Windows lane](../../.github/workflows/windows-tests.yml) is available for focused
Windows investigation while that suite is not a required gate.

### Mobile layout checks

The [Mobile Layout E2E workflow](../../.github/workflows/mobile-e2e.yml) checks the native app on
hosted iOS simulators and Android emulators for mobile pull requests. Dispatch it manually to
select a platform or specific device poses. Download the `mobile-e2e-ios` or `mobile-e2e-android`
artifact and open `index.html` for the checks, screenshots, and transition recordings.

For local reproduction on a prepared device host, run these commands from the repository root:

```sh
vp run mobile:e2e --list
vp run mobile:e2e --platform ios --pose iphone-se
vp run mobile:e2e --platform android --pose pixel-fold-unfolded
```

The host needs ffmpeg and the native build tools for its platform, including an installed iOS
runtime or Android SDK system image. The runner creates its own devices and seeded backend,
then removes them after the run. Local reports are written under `artifacts/mobile-e2e`.
Add `--review` to request an advisory screenshot review through an installed, authenticated
Claude CLI; ordinary CI checks do not need an AI account.

### Unused code

`vp run knip:check` checks unused files and dependencies across the repo, then
unused runtime exports in `apps/server`, `apps/desktop`, `apps/web`, and every internal package under
`packages/`. CI enforces both checks.
Exported types and Effect schemas are allowed without consumers. The schema preprocessor
recognizes schema types, including aliases and schema classes; functions that create or decode
schemas remain checked. Canonical Effect service construction APIs stay exported with an explicit
`@public` annotation, which Knip recognizes. Completely unused files remain checked too.
Named exports in web UI component modules are kept as complete component sets. Knip ignores
unused exports in `apps/web/src/components/ui/*.tsx`, while still reporting an entire unused file.
Use `vp run knip --workspace apps/web` to audit one workspace, including exports,
or `vp run knip:production --workspace apps/web` to find code kept alive only by tests.
The full export audit still has findings and is not a repo-wide CI gate. Extend the
export check's workspace selectors as more workspaces become clean. Review callers before
deleting code; production mode can also report development scripts and test fixtures.
Runtime-discovered entrypoints and dependency exceptions belong in [knip.jsonc](../../knip.jsonc).

## Desktop artifacts

Local artifact builds are unsigned by default and write to `release/`:

```sh
vp run dist:desktop:dmg
vp run dist:desktop:linux
vp run dist:desktop:win
```

DMGs default to the host architecture. Use `--arch` to choose another target and `--keep-stage`
to retain packaging files for inspection. `--without-codex-micro` leaves out the Codex Micro
keyboard and its native HID library; the app then hides that settings section. Run `vp run dist:desktop:artifact --help` for other
options.

### Linux AppImage prerequisites

Build on Linux because the browser-secret helper links against the host's libsecret. Install
Rust, C/C++ build tools, libsecret, libusb, and libudev development headers, pkg-config, and
ImageMagick.

Ubuntu and Debian:

```sh
sudo apt-get update
sudo apt-get install cargo rustc build-essential libsecret-1-dev libusb-1.0-0-dev libudev-dev pkg-config imagemagick
```

Fedora:

```sh
sudo dnf install rust cargo gcc gcc-c++ make libsecret-devel libusb1-devel systemd-devel pkgconf-pkg-config ImageMagick
```

Arch Linux:

```sh
sudo pacman -S rust base-devel libsecret libusb systemd-libs pkgconf imagemagick
```

The C toolchain, pkg-config, and libsecret headers are also needed for Linux desktop development.

### macOS DMG prerequisites

Install Xcode 27 or newer and Rust. Select Xcode's developer directory with `xcode-select`.
The full Xcode installation provides `actool`, which compiles the adaptive macOS app icon for
release bundles and the local desktop launcher.
For a cross-architecture or universal build, add the requested Rust targets:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### Windows installer prerequisites

Install Rust, Python 3, and Visual Studio Build Tools with **Desktop development with C++**.
Include the Windows SDK and the MSVC build tools and Spectre-mitigated libraries for the target
architecture. Add its Rust target:

```powershell
rustup target add x86_64-pc-windows-msvc
# For an ARM64 installer:
rustup target add aarch64-pc-windows-msvc
```

NSIS is downloaded by electron-builder. WSL support additionally needs the Linux CLI archive
passed as `--wsl-runtime`; see the
[release runbook](./release.md#windows-payload-topology-and-update-validation).

### Signing

Add `--signed` after configuring the platform credentials in the
[release runbook](./release.md).
