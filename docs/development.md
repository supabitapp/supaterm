# Development

## Bootstrap

Run setup from the repo root.

Initialize submodules:

```bash
git submodule update --init --recursive
```

Install pinned tools:

```bash
mise trust mise.toml
mise install
```

Install the Xcode release pinned by `.xcode-version` and
`.xcode-build-version`, select that installation, then verify it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
make xcode-check
```

Authenticate Tuist before using cache-backed generation or cache warming:

```bash
make tuist-cache-login
mise exec -- tuist auth whoami
```

Project generation uses Tuist's binary module cache. Xcode compilation caching
is disabled because it made normal local and first-run CI builds slower in our
benchmarks.

Secrets

Run commands that need project secrets through fnox:

```bash
mise exec -- fnox exec -- make mac-archive
```

fnox reads the `Supaterm Environment` item from the `Supaterm` 1Password vault. Keep secrets out of the interactive shell and use `fnox exec` for commands that need them. Never run `op signin`, export `OP_SERVICE_ACCOUNT_TOKEN`, or print secrets.

Generate the macOS workspace:

```bash
make mac-generate
```

Generate the iOS workspace:

```bash
make ios-generate
```

Generate one workspace with both apps:

```bash
make workspace-generate
```

Generate without external binary cache:

```bash
make mac-generate-sources
```

Warm the external Tuist cache:

```bash
make mac-warm-cache
```

### Commands

Canonical macOS gates:

```bash
make mac-check          # format + lint
make mac-test           # full test suite
```

Canonical iOS gates:

```bash
make ios-check
make ios-build
```

Useful macOS development commands:

```bash
make mac-generate       # Generate the Xcode workspace
make mac-xcode-open     # Open the Xcode workspace
make mac-build          # Debug build
make mac-run            # Debug run with isolated persistent state
make mac-inspect-dependencies # Check Tuist dependency graph hygiene
```

Useful iOS development commands:

```bash
make ios-generate
make ios-xcode-open
make ios-build
make ios-inspect-dependencies
```

The Apple projects share package versions through `apps/Tuist` and reusable targets through `apps/shared`.

Snapshot commands:

```bash
make mac-build-snapshot-catalog # Build the visual snapshot catalog app
make mac-test-snapshots         # Run snapshot tests
make mac-record-snapshots       # Regenerate snapshot PNG baselines locally
```

End-to-end commands:

```bash
make mac-test-e2e       # Run socket-driven E2E tests against the real app
```

E2E tests in `apps/mac/supatermE2E` spawn their own `supaterm.app` with a fresh instance name, state home, and `ZMX_DIR`, then control it through the `sp` socket protocol. They never attach to a running development or user instance.

UI tests in `apps/mac/supatermUITests` control the shared macOS desktop, input focus, and pasteboards. They disable zmx. Never run them locally. They're meant for CI.

Also prefer to write E2E tests over UI Tests if possible.

Use `$SUPATERM_CLI_PATH` inside Supaterm panes to call the Debug CLI injected by the running app instead of an installed `sp`:

```bash
"$SUPATERM_CLI_PATH" diagnostic
```

Useful diagnostics:

```bash
"$SUPATERM_CLI_PATH" instance ls
"$SUPATERM_CLI_PATH" diagnostic --json
"$SUPATERM_CLI_PATH" config validate
```

`diagnostic` reports what it finds even with no app running. `config validate` runs inside the app, so it needs a reachable instance and fails without one.

`sp internal` is private developer tooling. Never document it or its subcommands in `integrations/supaterm` or other user-facing skill docs.

## Versioning

Supaterm uses Calendar Versioning for public releases: `YY.release.patch`.

- Use `regular` for the first release of a year and normal feature releases. The first 2026 release after `1.3.7` is `26.0.0`; the next regular 2026 release is `26.1.0`.
- Use `hotfix` for patch-only follow-ups within the current release line. A hotfix after `26.1.0` is `26.1.1`.
- `MARKETING_VERSION` is the public version shown in the app, changelog, tags, GitHub releases, and Sparkle short version.
- `CURRENT_PROJECT_VERSION` is a private monotonic build number. Each version reserves a million builds: stable CI publishes `CURRENT_PROJECT_VERSION * 1000000`, and tip CI publishes `CURRENT_PROJECT_VERSION * 1000000 + github.run_number`. `github.run_number` never resets, so the reserve has to outlast every tip release the repo will ever cut.

Run stable releases from the repo root:

```bash
make bump-and-release
```

## Isolated App State

`make mac-run` gives the checkout one development identity: an instance name derived from the
checkout path and a state home at `apps/mac/.build/run-state/dev`. Layout and settings persist
across runs. Different checkouts derive different names, so worktrees stay isolated, and the
launch guard refuses a second concurrent run of the same checkout.

Local Debug and Release builds carry an isolated identity inside the bundle: a build phase stamps
`LSEnvironment` in the product's Info.plist with the checkout's instance name and state home.
Launching a local build through `open`, Finder, or an agent never uses `default` or shares state
with the installed app. Debug uses `dev-<checkout>` and `run-state/dev`; Release uses
`release-<checkout>` and `run-state/release`. Production archives carry no stamp and alone use
`default`. Explicit environment variables and raw binary launches are unaffected.

The stamped instance name also isolates each local build's license Keychain item. Debug uses an
in-memory license service and never contacts `license.supaterm.com`. The five-tab free-mode gate
is active in every build. Local Release builds use the live license service with their isolated
state and Keychain item for end-to-end checks. Only an unstamped production app uses the
production app's state and Keychain item.

Development launches and UI tests never start zmx. The zmx E2E suite opts in with an isolated zmx
directory. For a clean slate, quit the app, then delete the state home:

```bash
rm -rf apps/mac/.build/run-state/dev
```

`make mac-run` accepts these runtime overrides:

- `SUPATERM_RUN_INSTANCE_NAME` becomes `SUPATERM_INSTANCE_NAME` for the app process.
- `SUPATERM_RUN_STATE_HOME` becomes `SUPATERM_STATE_HOME` for the app process and spawned panes.

All Makefile app launch targets set `SUPATERM_VERBOSE_LOGGING=1`, so development runs always emit verbose diagnostics.

`make mac-run-demo` runs under its own `demo` identity and `run-state/demo` state home without zmx.
Demo rewrites its spaces, tabs, panes, `restoreTerminalLayoutEnabled`, `codingAgentsShowPanel`,
`zmxSessionsEnabled`, and the acknowledged release version on every launch, so the demo you see is
always freshly seeded; the state the seed never writes — the remaining settings, launch state, and
coding-agent state — carries over between demo runs.

Panes inherit Supaterm context from the running app:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_CLI_PATH`
- `SUPATERM_STATE_HOME` when an app state root is configured
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`
- `ZMX_DIR`, `ZMX_SESSION`, and `ZMX_SESSION_PREFIX` when zmx sessions are enabled

For login-shell panes, the app prepends its `Contents/MacOS` directory to `PATH`. The directory includes `sp`, `ap`, and `wt`. Direct launches keep the caller's `PATH` unchanged.

A pane with no startup command starts the account login shell. `--script` and agent-panel forks enter visible text in that shell, then return to the same shell when the command ends. Supaterm waits for shell readiness when the shell reports it; otherwise it queues the text when it creates the surface. Arguments after `--` use the caller's `PATH` and launch directly with exact arguments, without running shell startup files. The tab or pane closes when that process exits. Terminal configuration cannot replace the launch selected by Supaterm.

### SSH entry point

Typing `ssh` in a pane runs `sp ssh`. The bundled shell integrations define the wrapper whenever `SUPATERM_CLI_PATH` is executable and the pane has no Ghostty executable, so the route reads no `shell-integration-features` value and Supaterm never writes that key. A missing or unrunnable path leaves the shell's own `ssh` alone. The wrapper calls the exact path, so it reuses the signed CLI in the app bundle and cannot call an unbundled executable. `command ssh` skips the wrapper.

`sp ssh` owns the portable `xterm-256color` default, SSH executable choice, terminal environment, and `SendEnv` rules. It does not pass `SetEnv`, so user SSH config keeps ownership of those values. It replaces itself with `ssh`, so exit codes and signals are the user's own. Native Ghostty keeps its `+ssh` route and its `ssh-env` and `ssh-terminfo` features, including when launched from a Supaterm pane.

## Session persistence

State files under the Supaterm state root (`session.json`, `spaces.json`, `pinned-tabs.json`, `settings.toml`) hold user data. Breaking them destroys real user sessions.

- Session persistence must never break. Every release must load every state file the previous release wrote.
- Never bump a format version to discard old state. When the format changes, migrate the previous version to the current one. Purely additive optional fields need no version bump.
- When persistence logic changes, add tests that decode a fixture of the previous shipped on-disk format and assert the migrated result. Keep one fixture per shipped version.
- Treat any decode rejection of user state as a bug. A rejected `session.json` empties the layout silently, and the next launch reaps every zmx session the new catalog no longer references. There is no recovery after that.

## Marketing website

Web targets run through `vp`; `mise install` installs it via the postinstall hook.

Install dependencies:

```bash
make web-install
```

Run checks, tests, and production build:

```bash
make web-check
make web-test
make web-build
```

Run the Vite dev server:

```bash
make web-dev
```

Run the Cloudflare Worker locally after building:

```bash
make web-worker-dev
```

Deploy the Worker:

```bash
make web-deploy
```

## Documentation website

Install dependencies:

```bash
make docs-install
```

Run the Blume development server:

```bash
make docs-dev
```

Run strict content checks, link validation, and a production build:

```bash
make docs-check
make docs-validate
make docs-build
```

Preview or deploy the static site:

```bash
make docs-preview
make docs-deploy
```

## Submodules

For ghostty and zmx, we use `supaterm` branch only, rebase our changes on top of upstream cleanly if we need to update.

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.

When handling Codex, Claude Code, or another coding-agent integration, inspect real hook payloads before designing event behavior. Do not infer event shapes from source names or assumptions.

## Code Review

Before creating a PR or pushing stuff to main, always run a round of "thermos" review on and address what's valid and worth fixing.

For subagents models, use luna xhigh or opus xhigh latest whatever is available.

## Misc

- Prefer SF Symbols for icons. When a needed icon is unavailable, use `apps/mac/scripts/fetch-icon.sh`: `lucide` provides general glyphs, `simple-icons` provides brand marks, and `lobe-icons` provides coding-agent marks. Simple Icons marks are padded so edge-to-edge glyphs survive template rasterization. Lobe Icons writes `<name>-mark` assets and defaults to `@lobehub/icons-static-svg` 1.94.0. For example, run `apps/mac/scripts/fetch-icon.sh simple-icons github` or `apps/mac/scripts/fetch-icon.sh lobe-icons amp` from the repository root.
- Before implementing UI changes or new UI, include a concise ASCII diagram in the response to visualize the proposed layout or interaction.

## Licensing

The license service lives in the separate repository: https://github.com/supabitapp/supaterm-license
