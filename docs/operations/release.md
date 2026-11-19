# Release Checklist

> For maintainers. Using Supaterm? See [docs/user](../user/).

This document covers the unified release workflow for stable and nightly desktop releases.

## Browser Touch ID passkeys

Signed macOS builds enable the in-app browser's device-bound Touch ID passkeys only when a
Developer ID provisioning profile grants `<TEAM_ID>.com.supaterm.desktop.webauthn` in
`keychain-access-groups`. Set the optional `MACOS_PROVISIONING_PROFILE` release secret to the
base64-encoded profile. The release and macOS preview workflows share this setting. Local
packaging accepts the profile path through `SUPATERM_MACOS_PROVISIONING_PROFILE`.

The packager logs whether Touch ID is enabled and records the authorized group in the signed
package. Verify the installed app with `codesign -d --entitlements :- <app-path>` and create,
then use, a passkey in its Browser panel. Unsigned builds and profiles without the group leave
Touch ID disabled. These credentials stay on that Mac; system credential-provider ceremonies
are not enabled by this configuration.

## Version numbers

Public releases use `YY.MINOR.PATCH`, starting at `26.0.0` in 2026. Maintainers manually bump
the major to `27` in 2027; the release workflow treats it as an ordinary version number.
Use `node scripts/update-release-package-versions.ts 27.0.0` to align server, desktop, web,
and contracts, and update the mobile version in `apps/mobile/app.config.ts`. Mobile major
bumps require a new store binary under the existing OTA fingerprint policy.

## What the workflow does

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - manual `workflow_dispatch` with `channel=stable`, the normal way to ship stable. Stable
    and nightly dispatches must select `main`; preview may select any branch. The channel defaults
    to preview so an omitted selection cannot publish a stable release.
  - push tag matching `v*.*.*` for a stable release of an explicit commit
  - scheduled nightly check (see [Nightly builds](#nightly-builds))
  - manual `workflow_dispatch` with `channel=nightly`
  - manual `workflow_dispatch` with `channel=preview`, the maintainers' test train. It exercises the release flow up to a draft release (build, sign, notarize, smoke) for a commit that end users must never receive, which is how an unmerged branch or a risky change gets a real release run before it lands. It builds the triggering commit with nightly's versioning under the `preview` prerelease identifier (`0.0.41-preview.<date>.<run>`) and leaves its GitHub prerelease as a draft. It publishes nothing to npm; `check_cli_publish` still runs its dry run under the `preview` dist-tag. It stays a draft because a draft has no git tag, and published preview tags hide nightlies from the updater (see [Update feed](#update-feed)). Do not publish a preview draft by hand. Preview runs only on manual dispatch, its desktop builds carry no update feed, and no updater manifest (`latest*.yml`, `nightly*.yml`, blockmaps) is attached, so a stable or nightly install cannot be offered one. The only ways onto a new preview are by hand: the draft release, which maintainers can open, and the run's Actions artifacts. A draft's files are not public, so `SUPATERM_CHANNEL=preview` and `supaterm update --channel preview` see only previews published before this rule, and `npx supaterm@preview` resolves only a preview published before it. Rebase a branch onto `main` before dispatching a preview from it. The run uses the branch's own `release.yml`, and an older copy publishes the preview with a tag. The release itself is named as a maintainer test build and its body is a warning rather than generated notes: a changelog of unmerged branch history is not a changelog, and nightly and stable notes are unaffected because each series resolves its previous tag within its own channel. The hosted web app and AUR are skipped. Keep it; it costs nothing when idle.
- A manual stable release builds the commit of the latest published nightly, not `main` HEAD.
  Nightly is the release candidate: verify the nightly, then promote it. Merges to `main` keep
  landing while you verify and never leak into the stable build.
  - The version defaults to the one the nightly previewed (`0.0.39-nightly.*` ships as `0.0.39`).
    Pass the `version` input to override it, for example for a minor bump.
  - The stable tag is created on the nightly's commit when the GitHub Release is published.
  - Pushing a `vX.Y.Z` tag by hand still works and builds exactly the tagged commit. Use it when
    the commit to ship is not the latest nightly, such as a cherry-picked fix on a release branch.
- Runs lint, typecheck, and tests alongside artifact builds. Publishing waits for every check.
- Builds the platform-independent JS (server bundle, web client, Electron main) once in the `build_bundle` job and hands it to every platform job as the `js-bundle` artifact; the platform jobs only package it, so no runner rebuilds it.
- Builds six desktop artifacts in parallel for both channels, each as its own job (`desktop_<platform>_<arch>`, one call of `release-desktop.yml`), gated only on the bundle. macOS and Linux targets build on hardware of their own architecture. Both Windows targets build and sign (with jsign) on a Linux runner, which packages faster than Windows runners, and a Windows job of the target's architecture (`windows-2025` or `windows-11-arm`, the `verify_runner`) runs the packaged natives and the CLI archive. The Windows jobs embed the same-arch Linux CLI archive as the WSL runtime and wait for that artifact, not for the Linux desktop build:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` and `arm64` AppImage and `.deb`, from one electron-builder run. The `.deb` updates in the app through electron-updater, which installs it with `dpkg`.
  - Windows `x64` and `arm64` NSIS installer
- Opens the packaged Linux x64 AppImage (under Xvfb) and macOS arm64 DMG against a seeded database and opens a thread (`scripts/smoke-desktop-app.ts`). A build whose backend or bundle cannot start fails here, so nothing is published. The database in `scripts/fixtures/desktop-launch` comes from `apps/server/scripts/desktop-launch-fixture.ts` and stays old on purpose: the packaged server must migrate it forward, as it does for upgrading users. Do not regenerate it on schema changes.
- The macOS arm64 CLI job also builds `supaterm-installer.dmg` from `native/mac-installer` (`scripts/build-mac-installer.ts`). Nightly builds it so a broken build shows up there first, but only stable releases publish it. It is a small universal app, and the website's macOS buttons link to it. When opened, it reads `latest-mac.yml` from the release marked latest, downloads the `-arm64.zip` or `-x64.zip` it lists from tag `v<version>`, and checks the sha512, our team ID, and notarization before installing. Copies people have already downloaded keep depending on that feed name, those zip suffixes, the tag format, and the team ID, so changing any of them breaks installers in the wild. It always installs stable, which is why nightly releases do not carry it.
- Publishes one GitHub Release with all produced files.
  - Stable tags with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain stable `X.Y.Z` releases are marked as the repository's latest release.
  - Nightly runs are always GitHub prereleases and never marked latest.
  - Automatically generated release notes are pinned to the previous tag in the same channel, so stable compares to the previous stable tag and nightly compares to the previous nightly tag.
  - After publishing, the `release_notes` job (`scripts/generate-release-notes.ts`) replaces the body of stable and nightly releases with a computed header line, a short Claude Opus 5.5 summary, and GitHub's generated list folded under `<details>`. It reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` from the `release-notes-llm` item in the release vault through the `release-notes` fnox profile; the balancer behind them only serves Opus to requests whose system prompt opens with Claude Code's identity line. The summary leaves out commits whose scopes are all mobile; the header counts every first-parent commit. The desktop update popover, on every channel, shows the highlights paragraph and the header counts per release. If the step fails or there is nothing to summarize, the release keeps GitHub's generated notes.
- Includes Electron auto-update metadata (for example `latest*.yml`, `nightly*.yml`, and `*.blockmap`) in release assets.
- Builds a self-contained CLI archive per platform (`supaterm-<version>-<platform>-<arch>.tar.gz`, `.zip` on Windows) in a job of its own beside that target's desktop build and attaches them to the GitHub Release with a `SHA256SUMS` file, on every channel, for five targets: macOS arm64, Linux x64 and arm64, Windows x64 and arm64. Every archive is smoke-tested on hardware of its own architecture, and every one but the Windows archives is also built and signed there. There is no macOS x64 archive: Node single-executables are unsupported on x64 macOS (the SEA docs list macOS as arm64 only) and the binary segfaults on start; the x64 desktop app is Electron and unaffected.
  - The archive holds the server as a Node single-executable (`scripts/build-cli-archive.ts`), so unpacking it needs neither Node, npm, nor a compiler. It is the only form in which Supaterm manages a runtime: the desktop's SSH environments, the boot service, `supaterm update`, and the install scripts all download and verify this archive against `SHA256SUMS`. The `supaterm` npm package exists for people who run `npx supaterm` or `npm install -g supaterm` themselves, and it downloads this same archive too; nothing in the product installs from npm. The `curl | sh` installers are `scripts/install.sh` and `scripts/install.ps1`; the marketing site copies them into its `public/` at build time (`apps/marketing/scripts/stage-install-scripts.mjs`) and serves them at `supaterm.com/install.sh` and `/install.ps1`.
  - Every executable embeds the exact Node in `SEA_NODE_VERSION` (`apps/server/scripts/seaNodeVersion.ts`), the only place that version is set. `build-exe` runs the pack on it through `vp env exec --node`; native builds reject a different host Node, and cross-target builds download that version for their target. TEMPORARY: Linux arm64 executables build only on a Linux arm64 host and are injected with postject, because Node's `--build-sea` output cannot load on 16 or 64 KiB page kernels. Revert when [nodejs/node#67048](https://github.com/nodejs/node/issues/67048) is fixed. Development, CI, and the desktop backend stay on the mise Node, the line Electron ships. Keep the version exact: only exact versions have a `nodejs.org/dist` directory. Runtime changes need a new release version because installed runtimes are cached by that version.
  - Release macOS archives are signed with the Developer ID certificate and notarized using the Apple credentials loaded through fnox. Windows executables use the same Azure Trusted Signing setup as the installer. Every native addon in the macOS archive is signed too, since the hardened runtime refuses unsigned libraries.
  - Each archive is extracted and executed (`scripts/smoke-cli-archive.ts`) on its build runner, or on the `verify_runner` for Windows.
- After the GitHub Release is published, publishes the `supaterm` npm package with OIDC trusted publishing from the same workflow file. It is only a launcher (`scripts/npm-launcher/supaterm.mjs`, packed by `scripts/build-npm-launcher.ts`): on first run it downloads its exact version's CLI archive from the GitHub Release (or from `SUPATERM_RELEASE_BASE_URL`), verifies it against `SHA256SUMS`, and unpacks it into `<Supaterm home>/runtime/versions/<version>`, the layout the install scripts and `supaterm update` share. The executables are not on npm: its publish-time scanning can hold 80-250 MB packages back for up to an hour after the launcher is live, and every install in that window would get a launcher with no executable. The old `@supabitapp/supaterm-<platform>-<arch>` packages get no new versions. Because the launcher reads from the release, `publish_cli` runs after `release`, never before. `release` waits for `check_cli_publish`, which packs the launcher and runs `npm publish --dry-run`, so a publish that would fail stops the run before the GitHub Release is public.
  - stable releases publish npm dist-tag `latest`
  - nightly releases publish npm dist-tag `nightly`
  - preview releases publish nothing to npm
  - one-time setup: package `supaterm` needs a trusted publisher registered for this workflow file (see below).
- Builds the hosted web app for Cloudflare while the desktop jobs run, and makes it live only after a release is published:
  - stable releases are aliased to the `latest` hosted app channel
  - nightly releases are aliased to the `nightly` hosted app channel
- Release macOS jobs require Apple credentials from 1Password. Windows signing is auto-detected from its Azure secrets.

## Mobile store review

[Mobile Production](../../.github/workflows/mobile-eas-production.yml) automatically uploads newly built
production binaries to TestFlight and Google Play internal testing. A push to `main` compiles a new binary
when its app version is unrecorded or no recorded build matches its native fingerprint, and publishes an OTA
update whenever a fingerprint-compatible binary exists. Production OTAs reach only binaries with the same
native fingerprint. Apple rejects new builds of a live version, so once Mobile Store Review sends an iOS
version for App Store review, native changes on that version no longer build: the run warns, and bumping
the app version ships them. After a successful upload, it records
the source commit, app version, and native build number from the signed binary. On `main`, the workflow
submits each uploaded iOS build for external beta review and adds it to `Supaterm Public Beta`, with
tester notifications enabled after approval. The beta job uses the `release` environment's existing
App Store Connect API key and waits up to 45 minutes for Apple to process the exact build. Rerun a
failed beta job to retry submission without rebuilding. If another build of the same version is in
beta review, the job names that build; retry after Apple finishes its review. Apple still controls beta approval.
App Store review is a separate, optional step.

To submit a build for review, dispatch [Mobile Store Review](../../.github/workflows/mobile-store-review.yml)
on `main` with the platform, original Mobile Production run ID, and source SHA from the build's job summary.
Artifacts last 14 days. Each platform needs its own dispatch, so an iOS failure does not block Android.

The review workflow captures the [native screenshot matrix](mobile-app-store-screenshots.md) at the
same source commit and validates every image before preparing Fastlane folders. The Android assets
also include a 512-pixel icon cropped from the production launcher artwork and the checked-in feature graphic.
Fastlane waits up to 45 minutes for the exact iOS build to finish processing, uploads the screenshots,
and submits it for App Store review. Apple publishing remains manual after approval. The Android lane
promotes the exact internal version code to production with a full rollout and commits the edit for
review. It fails if Google requires a separate manual submission instead of reporting success.

Submission runs only on `main` in the GitHub `release` environment. The `app-store` fnox profile
reads the existing App Store Connect team API key from 1Password using `OP_SERVICE_ACCOUNT_TOKEN`.
That key needs permission to manage the App Store release. Android uses `EXPO_TOKEN` to download the
existing Google Play submission service account from EAS into a temporary file, which the job removes
afterward. Store agreements, privacy declarations, and account-level access must already be complete.
Only signed production binaries with a recorded build identity are eligible for review.

To retry after fixing a store-side issue, dispatch the review workflow again with the same inputs.
The workflow selects the newest build attempt per platform from that source and skips a
build that has already reached the review or production stage. It does not withdraw an active review.

### App review environment

Apple reviews the app against a hosted example environment on `supacode-app-review.exe.xyz`, an exe.dev
VM. Both iOS lanes write the reviewer instructions from
[`review-notes.txt`](../../apps/mobile/fastlane/review-notes.txt), and the store lane attaches a QR code.
Deliver deletes review attachments it is not given, so an attachment added by hand in App Store Connect
does not survive the next submission. The repository secrets `MOBILE_REVIEW_INVITE_URL` (the
[access page](../../scripts/mobile-review-access/server.ts) invitation) and `MOBILE_REVIEW_PAIRING_URL`
(the URL the QR code encodes) fill them in, and the store lane stops if the VM rejects that QR code.

Pairing codes normally work once, so the access service swaps the QR code's fixed review code for a
fresh one at `/oauth/token`. The VM keeps only SHA-256 digests of the review code and invitation in
`/etc/supacode-review-access.env`. To rotate either, update the digest, restart
`supacode-review-access`, and update the matching secret.

[`update-environment.sh`](../../scripts/mobile-review-access/update-environment.sh) runs daily from
`supacode-review-update.timer`. If a release cannot open the existing database, it archives the state
under `/srv/supacode-review/old-*` and reseeds the examples; any failure restores the previous runtime,
state, and admin token. The VM does not pull these scripts itself: after changing them, copy them to
`/opt/supacode-review/bin` and the bundled `server.mjs` to `/opt/supacode-review/access`.

## Required release credentials

Store `OP_SERVICE_ACCOUNT_TOKEN` in the GitHub `release` environment. Its read-only 1Password service
account needs access to the `Supaterm` vault. The environment must allow `main` for manual and
scheduled releases, plus release tags for tag-triggered runs. Preview branches need explicit access
before dispatch. The fnox profiles in [`.github/fnox.toml`](../../.github/fnox.toml) resolve the Apple
signing fields from `Supacode Next Apple Desktop Signing` and these fields from `Supacode Next GitHub Release App`:

- `RELEASE_APP_ID`
- `RELEASE_APP_PRIVATE_KEY`

Credential lookup failures stop the job. The finalize job uses the App credentials to commit and push aligned package versions to `main` as the Release App.
GitHub Release publication uses the repository-scoped workflow token so it has a rate-limit quota
independent from the shared Release App installation.

## Cloudflare hosting

Cloudflare Workers serves the marketing site and hosted web client. The agent server continues to run on users' machines. Hosting configuration lives in `apps/marketing/wrangler.json` and `apps/web/cloudflare/`.

The release workflow builds static assets while desktop jobs run and uploads them as GitHub artifacts. Deployment starts only after the GitHub Release succeeds. Stable releases update `latest.app.supaterm.com`; nightly releases update `nightly.app.supaterm.com` and the marketing site at `supaterm.com`. Stable releases leave the marketing site unchanged because they can promote an older nightly commit.

`app.supaterm.com` routes requests to the selected channel. Visiting `/__supaterm/channel?channel=latest` or `/__supaterm/channel?channel=nightly` saves the `supaterm_web_channel` cookie and redirects to the app root. Builds receive the release version through `APP_VERSION` and the channel through `VITE_HOSTED_APP_CHANNEL`.

The `cloudflare` fnox profile reads `CLOUDFLARE_API_TOKEN` from the `Supacode Next Cloudflare Hosting` item in the `Supaterm` vault. The token needs Workers Scripts edit access in the configured account, plus Workers Routes edit and Zone read access for `supaterm.com`. Deployment jobs use the `release` GitHub environment. Wrangler manages the custom domains and their certificates.

Web previews deploy automatically for trusted authors when a PR opens, reopens, or receives new
commits, including fork PRs. The trust policy is the same as for macOS previews: bots,
collaborators, and contributors in the default branch's `.github/VOUCHED.td`. The existing
`vouch:trusted`, `vouch:unvouched`, and `vouch:denounced` labels report that status; applying a
label by hand does not grant trust. Apply `preview:web` to rebuild the current commit. The
workflow consumes that optional label, and closing the PR deletes its deployment.

PR builds produce static assets without hosting credentials. A separate workflow from the default
branch checks author trust again, validates the artifact, and deploys to
`preview-<number>.supaterm.com`. The `web-preview` GitHub environment supplies
`OP_SERVICE_ACCOUNT_TOKEN` only to that deployment job. Open the URL posted on the pull request
and pair a reachable server under Settings → Environments.

## Nightly builds

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - scheduled check of `main` every night at 08:08 UTC, just after midnight Pacific (`8 8 * * *`)
  - manual `workflow_dispatch` with `channel=nightly`
- Automatic nightlies require commits ahead of the latest published nightly, including manual nightlies.
- To pause automatic nightlies, run `gh variable set PAUSE_NIGHTLY -b true -R supabitapp/supaterm`. Scheduled runs then skip. Stable, preview, and manual nightly runs are unaffected. Resume with `gh variable delete PAUSE_NIGHTLY -R supabitapp/supaterm`.
- Manual nightlies bypass the change check. Nightly runs remain serialized. Automatic runs wait for an active nightly to finish, then skip commits already included in the latest nightly.
- Runs the same desktop quality gates and artifact matrix as the tagged release flow.
- Publishes a GitHub prerelease only:
  - current tag format: `vX.Y.Z-nightly.YYYYMMDD.<run_number>`
  - release name includes the short commit SHA
  - `make_latest` is always `false`
- Uses the next stable patch version as the nightly base. For example, `0.0.17` produces nightlies on `0.0.18-nightly.*`.
- Publishes Electron auto-update metadata to the dedicated `nightly` updater channel, so desktop users can opt into that track independently from stable.
- Publishes the `supaterm` npm launcher to the `nightly` npm dist-tag using the same nightly version.
- Does not commit version bumps back to `main`.

## Server self-update release invariant

Connected servers update to the client's exact version, not to an npm dist-tag. Servers that update
themselves download that version's CLI archive from the GitHub Release; servers run through npm are
handed a `supaterm@<version>` command to run. Every released client version must therefore have its
release archives, and then its npm launcher, available before users can receive that client.

The workflow enforces this ordering:

1. `release` publishes the GitHub Release with the CLI archives and `SHA256SUMS`, once
   `check_cli_publish` has run the npm publish as a dry run. Stable and nightly upload to a draft
   and publish only after all assets are attached, so a new version in the desktop update feed
   already has its archives. Rerunning `release` after publication replaces assets in a public
   release, so service updates can fail until the upload finishes.
2. `publish_cli` publishes the `supaterm@<version>` launcher, which downloads from that release, on
   stable and nightly. A preview stays a draft and publishes no launcher.
3. `deploy_web` depends on both before moving the hosted channel to the new client.
   `build_web` stages static assets as a GitHub artifact without exposing the new client. Cloudflare receives those assets only in `deploy_web`.

Desktop auto-update reads the GitHub Release directly, so a desktop client can see the new version
a few minutes before `supaterm@<version>` is on npm. **Update everything** does not wait for npm:
boot-service and desktop-managed servers update from the GitHub Release. Until `publish_cli`
finishes, only the copied manual command for npm-run servers does not resolve yet.

Preserve these dependencies when changing the release graph. Publishing a client first would leave
the **Update server** action targeting a package version that does not exist yet.

For a release smoke test, confirm `npm view supaterm@<version> version` returns the expected version, then
connect the new client to a server on the previous version and verify that the update action
reconnects to the matching server. When the release adds database migrations, verify that the
remote update applies them and reconnects. A failed trial must restore the database snapshot and
restart the previous server. If the installed launcher does not support the target protocol,
verify that the update stops before restart and run `npx supaterm@<version> service install` once on the
server machine. Also test the manual or desktop-managed guidance when those environments are
available.

## Update feed

A nightly install finds the newest nightly in up to three places.

- `releases.atom` lists the 10 newest git tags in the repository, of any kind, and a day's
  `preview` tags can sort above its `nightly` ones. Every install reads it first and takes its first
  nightly entry. Builds older than the update-feed pointer read nothing else. Ten other tags in
  a row hide every nightly from them.
- `releases/download/update-feed/nightly.json` names the newest nightly. Installs that know the
  pointer read it after the feed and take the newer of the two, so their updates do not depend on
  tag order. The `update-feed` release holds that file. Never delete it.
- The GitHub REST API, without auth, at 60 requests per hour per IP. Installs scan it when the
  feed has no nightly. Installs that know the pointer do so only when the pointer also offers
  nothing new.

The release workflow's `Check the update feed` job runs on every scheduled tick, unless
`PAUSE_NIGHTLY` is set, and after every nightly. It waits in the same queue as nightlies and
previews. It rewrites a missing or outdated pointer. Its last step fails when the first nightly
in the feed is not the newest one. The feed can lag a release published seconds earlier, so the
job first reads it up to three more times, 30 seconds apart. A feed it could not read is only a
warning: that says nothing about the tags, and the next tick reads it again.

When that step fails, installs that read only the feed cannot reach the newest nightly. If the
feed still names an older nightly first, installs without the pointer miss it too, because their
API scan runs only when the feed has no nightly at all. The job log lists the tags in the feed.
The usual cause is a preview dispatched from a branch that was not rebased onto `main`. Delete the tags nothing needs with `git push origin :refs/tags/<tag>`.
Converting a release to a draft keeps its tag, so it does not help. To keep this from happening,
anything users should not be offered stays a draft or uses one rolling tag, like `desktop-preview`.

To pull a bad nightly, delete its release and tag, then run
`gh release delete-asset update-feed nightly.json`. Installs fall back to the feed until the next
unpaused tick or manual nightly rewrites the pointer. Without that command, installs that know the
pointer report an update error until then. If npm's `nightly` dist-tag still names the pulled
build, also move it to the last good one with `npm dist-tag add supaterm@<version> nightly`. The channel
switch in Settings reads that tag and refuses an older desktop build.

## Desktop auto-update notes

- Updater runtime: `apps/desktop/src/updates/DesktopUpdates.ts`.
- `electron-updater` adapter: `apps/desktop/src/electron/ElectronUpdater.ts`.
- `apps/desktop/src/main.ts` only wires the updater layers into the desktop runtime.
- Update UX:
  - Background checks run on startup delay + interval.
  - No automatic download or install.
  - The desktop UI shows a rocket update button when an update is available; click once to download, click again after download to restart/install.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- Repository slug source:
  - `SUPATERM_DESKTOP_UPDATE_REPOSITORY` (format `owner/repo`), if set.
  - otherwise `GITHUB_REPOSITORY` from GitHub Actions.
- Required release assets for updater:
  - platform installers (`.exe`, `.dmg`, `.AppImage`, `.deb`, plus macOS `.zip` for Squirrel.Mac update payloads)
  - channel metadata: `latest*.yml` for stable releases, `nightly*.yml` for nightly releases
  - `*.blockmap` files (used for differential downloads)
- macOS metadata note:
  - `electron-updater` reads `latest-mac.yml` on stable and `nightly-mac.yml` on nightly, for both Intel and Apple Silicon.
  - The workflow merges the per-arch mac manifests into one channel-specific mac manifest before publishing the GitHub Release.

### Windows payload topology and update validation

Windows packages the bundled server and only its runtime-external/native
dependency closure in `resources/server.asar`. Native modules and helper
executables declared as unpacked by that archive must be present at the matching
paths below `resources/server.asar.unpacked`. The Windows-native backend reads
the archive in place through Electron. Packaged Windows builds also ship
`resources/wsl-runtime.tar.gz` plus its SHA-256 sidecar: the Linux CLI archive
(`supaterm-<version>-linux-<arch>.tar.gz`, the same arch as the Windows host) built
by the Linux desktop job and handed to the Windows desktop build as
`--wsl-runtime`, copied in verbatim so WSL runs the exact bytes a Linux user
downloads. WSL verifies and extracts that archive
into `~/.supaterm/wsl-runtime/sha256-<archive-digest>` inside the selected distro,
then reuses it for later launches of the same update.

Windows keeps JavaScript and package metadata inside `app.asar` and unpacks only
native libraries and helper executables. Avoid enabling whole-package smart
unpacking: each loose file adds work to NSIS installation and counts against
the payload limit.

The artifact builder rejects a Windows package when any of these invariants
break:

- `resources/server.asar` is absent or does not contain the server entry.
- Any file marked unpacked in the ASAR header is absent from
  `resources/server.asar.unpacked`.
- On same-architecture Windows builds, the packaged primary cannot load the fff
  native library from inside `server.asar` through its `.unpacked` sibling.
- The isolated, extracted sidecar cannot load the server entry with plain Node.
- A Windows build given `--wsl-runtime` omits the WSL archive or SHA-256
  sidecar, or the sidecar digest does not match the emitted archive.
- The emitted WSL archive is not a Linux CLI release archive: it must unpack to
  a single `supaterm-<version>-linux-<arch>` directory holding `supaterm`, `client/`, and
  `node_modules/` with the Linux node-pty binary, and must not carry a loose
  server bundle (`bin.mjs`).
- The external Windows resource monitor is absent.
- The unpacked Windows application contains more than 80 files.

Cross-architecture Windows builds retain every structural and extracted-sidecar
check, but skip executing the target Electron binary. A same-architecture build
for each release target must exercise the primary native-load probe.

NSIS differential packaging remains enabled. A sidecar layout transition can
produce a larger one-time download; subsequent small releases retain their
blockmaps, with a 60 MB maximum for a representative sidecar-to-sidecar update.

## 0) npm OIDC trusted publishing setup (CLI)

`build_bundle` builds the version-matched `supaterm.tgz` with `node scripts/build-npm-launcher.ts` and
uploads it as the `npm-launcher` artifact. After the GitHub Release is published, `publish_cli`
checks out only what it needs to set up the project's Node.js, downloads that exact upload by the
artifact ID `build_bundle` outputs (never by name), checks the tarball version, and runs
`npm publish --provenance` on it. That is the only package published per release.

Checklist:

1. Confirm the publishing account owns `supaterm`.
2. For `supaterm`, configure a Trusted Publisher in the npm package settings:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow file: `.github/workflows/release.yml`
   - Environment (if used): match your npm trusted publishing config
3. Ensure npm account policies allow trusted publishing for the package.
4. Create release tag `vX.Y.Z` and push; the workflow publishes the GitHub Release and then the
   launcher with npm dist-tag `latest`.
5. Nightly runs publish with npm dist-tag `nightly`; preview runs do not publish.

## 1) Release validation and unsigned builds

There is no dry-run tag path. Pushing any accepted non-nightly tag, including
`v0.0.0-test.1`, classifies the run as the stable channel. It publishes `supaterm` with npm dist-tag
`latest`, creates a real GitHub Release, aliases the hosted app to `latest.app.supaterm.com` and
`app.supaterm.com`, and can commit a version bump to `main` in the finalize job. Do not push a test tag
to validate the workflow.

The workflow has no non-publishing `workflow_dispatch` mode. Use normal CI or local quality gates to
validate checks and builds without shipping. To exercise the complete release graph at lower stable
risk, manually dispatch `channel=nightly`; this still publishes a real nightly npm package, GitHub
prerelease, desktop updater release, hosted nightly alias, and marketing site, but it does not update stable app aliases or
commit a version bump to `main`. Only run it when a real nightly release is acceptable.

Manual `channel=stable` is also a real stable-channel release. Missing Apple credentials stop macOS release jobs. Missing Windows signing secrets produce unsigned
Windows artifacts; they do not prevent publication.

## 2) Apple signing + notarization setup (macOS)

Required fields in the `Supacode Next Apple Desktop Signing` item in the `Supaterm` vault:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Checklist:

1. Apple Developer account access:
   - Team has rights to create Developer ID certificates.
2. Create a `Developer ID Application` certificate.
3. Export the certificate + private key as `.p12` from Keychain.
4. Base64-encode the `.p12` and store as `CSC_LINK`.
5. Store the `.p12` export password as `CSC_KEY_PASSWORD`.
6. In App Store Connect, create an API key (Team key).
7. Add API key values:
   - `APPLE_API_KEY`: contents of the downloaded `.p8`
   - `APPLE_API_KEY_ID`: Key ID
   - `APPLE_API_ISSUER`: Issuer ID
8. Re-run a tag release and confirm macOS artifacts are signed/notarized.

Notes:

- `APPLE_API_KEY` is stored as raw key text in 1Password.
- The workflow writes it to a temporary `AuthKey_<id>.p8` file at runtime.

## 3) Azure Trusted Signing setup (Windows)

Required secrets used by the workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

Checklist:

1. Create Azure Trusted Signing account and certificate profile.
2. Record ATS values:
   - Endpoint
   - Account name
   - Certificate profile name
   - Publisher name
3. Create/choose an Entra app registration (service principal).
4. Grant service principal permissions required by Trusted Signing.
5. Create a client secret for the service principal.
6. Add Azure secrets listed above in GitHub Actions secrets.
7. Re-run a tag release and confirm Windows installer is signed.

## 4) Ongoing release checklist

1. Pick the latest nightly and verify it: run the smoke test above against its artifacts and
   check the nightly channel for regressions.
2. Dispatch the Release workflow with `channel=stable`. Leave `version` empty unless the version
   should differ from the one the nightly previewed.
3. Confirm the `Resolve release commit` notice names the nightly tag and commit you verified. If a
   newer nightly published in between, the run builds that one instead.
4. Verify workflow steps:
   - preflight passes
   - release quality checks pass
   - `build_bundle` and all platform builds pass
   - release job uploads expected files
   - `publish_cli` publishes the exact release version after the release job
5. Smoke test downloaded artifacts.

## 5) Troubleshooting

- macOS build unsigned when expected signed:
  - Check the service account can read all Apple fields in `Supaterm`.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Release macOS jobs require their fnox profile to resolve; use the unsigned PR preview workflow for an unsigned build.
  - Re-check certificate/profile names and tenant/client credentials.
