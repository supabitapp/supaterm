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
  - manual `workflow_dispatch` with `channel=preview`, the maintainers' test train. It exercises the whole release flow (build, sign, notarize, smoke, publish) for a commit that end users must never receive, which is how an unmerged branch or a risky change gets a real release run before it lands. It builds the triggering commit with nightly's versioning under the `preview` prerelease identifier (`0.0.41-preview.<date>.<run>`) and publishes a GitHub prerelease plus the npm launcher under the `preview` dist-tag. Preview runs only on manual dispatch, no default npm dist-tag points at it, its desktop builds carry no update feed, and no updater manifest (`latest*.yml`, `nightly*.yml`, blockmaps) is attached, so a stable or nightly install cannot be offered one. The only ways onto it are downloading the release by hand, `npx supaterm@preview`, `SUPATERM_CHANNEL=preview` for the install scripts, or `supaterm update --channel preview` from a terminal; each prints a warning, and the CLI asks for confirmation when the running build is not itself a preview. The release itself is named as a maintainer test build and its body is a warning rather than generated notes: a changelog of unmerged branch history is not a changelog, and nightly and stable notes are unaffected because each series resolves its previous tag within its own channel. The hosted web app and AUR are skipped. Keep it; it costs nothing when idle.
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
- Builds six desktop artifacts in parallel for both channels, each as its own job (`desktop_<platform>_<arch>`, one call of `release-desktop.yml`) on hardware of its own architecture, gated only on the bundle. The Windows jobs embed the same-arch Linux CLI archive as the WSL runtime and wait for that artifact partway through, not for the whole Linux job:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` and `arm64` AppImage and `.deb`, from one electron-builder run. The `.deb` updates in the app through electron-updater, which installs it with `dpkg`.
  - Windows `x64` and `arm64` NSIS installer
- Publishes one GitHub Release with all produced files.
  - Stable tags with a suffix after `X.Y.Z` (for example `1.2.3-alpha.1`) are published as GitHub prereleases.
  - Only plain stable `X.Y.Z` releases are marked as the repository's latest release.
  - Nightly runs are always GitHub prereleases and never marked latest.
  - Automatically generated release notes are pinned to the previous tag in the same channel, so stable compares to the previous stable tag and nightly compares to the previous nightly tag.
- Includes Electron auto-update metadata (for example `latest*.yml`, `nightly*.yml`, and `*.blockmap`) in release assets.
- Builds a self-contained CLI archive per platform (`supaterm-<version>-<platform>-<arch>.tar.gz`, `.zip` on Windows) in the same job as that target's desktop artifact and attaches them to the GitHub Release with a `SHA256SUMS` file, on every channel, for five targets: macOS arm64, Linux x64 and arm64, Windows x64 and arm64. Every archive is built, signed, and smoke-tested on hardware of its own architecture. There is no macOS x64 archive: Node single-executables are unsupported on x64 macOS (the SEA docs list macOS as arm64 only) and the binary segfaults on start; the x64 desktop app is Electron and unaffected.
  - The archive holds the server as a Node single-executable (`scripts/build-cli-archive.ts`), so unpacking it needs neither Node, npm, nor a compiler. It is the only form in which Supaterm manages a runtime: the desktop's SSH environments, the boot service, `supaterm update`, and the install scripts all download and verify this archive against `SHA256SUMS`. The `supaterm` npm package exists for people who run `npx supaterm` or `npm install -g supaterm` themselves, and it downloads this same archive too; nothing in the product installs from npm. The `curl | sh` installers are `scripts/install.sh` and `scripts/install.ps1`; the marketing site copies them into its `public/` at build time (`apps/marketing/scripts/stage-install-scripts.mjs`) and serves them at `supaterm.com/install.sh` and `/install.ps1`.
  - The executable is built with a Node that supports `--build-sea` (`VP_NODE_VERSION=26.8.2`, kept in step with `SEA_NODE_VERSION` in `apps/server/vite.config.ts`), while the repo stays on `engines.node`.
  - Release macOS archives are signed with the Developer ID certificate and notarized using the Apple credentials loaded through fnox. Windows executables use the same Azure Trusted Signing setup as the installer. Every native addon in the macOS archive is signed too, since the hardened runtime refuses unsigned libraries.
  - Each archive is extracted and executed on its build runner (`scripts/smoke-cli-archive.ts`) before it is uploaded.
- After the GitHub Release is published, publishes the `supaterm` npm package with OIDC trusted publishing from the same workflow file. It is only a launcher (`scripts/npm-launcher/supaterm.mjs`, packed by `scripts/build-npm-launcher.ts`): on first run it downloads its exact version's CLI archive from the GitHub Release (or from `SUPATERM_RELEASE_BASE_URL`), verifies it against `SHA256SUMS`, and unpacks it into `<Supaterm home>/runtime/versions/<version>`, the layout the install scripts and `supaterm update` share. The executables are not on npm: its publish-time scanning can hold 80-250 MB packages back for up to an hour after the launcher is live, and every install in that window would get a launcher with no executable. The old `@supabitapp/supaterm-<platform>-<arch>` packages get no new versions. Because the launcher reads from the release, `publish_cli` runs after `release`, never before. `release` waits for `check_cli_publish`, which packs the launcher and runs `npm publish --dry-run`, so a publish that would fail stops the run before the GitHub Release is public.
  - stable releases publish npm dist-tag `latest`
  - nightly releases publish npm dist-tag `nightly`
  - preview releases publish npm dist-tag `preview`, which nothing resolves unless asked for by name
  - one-time setup: package `supaterm` needs a trusted publisher registered for this workflow file (see below).
- Builds the hosted web app for Cloudflare while the desktop jobs run, and makes it live only after a release is published:
  - stable releases are aliased to the `latest` hosted app channel
  - nightly releases are aliased to the `nightly` hosted app channel
- Release macOS jobs require Apple credentials from 1Password. Windows signing is auto-detected from its Azure secrets.

## Mobile store review

[Mobile Production](../../.github/workflows/mobile-eas-production.yml) automatically uploads newly built
production binaries to TestFlight and Google Play internal testing. After a successful upload, it records
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

## Pull request macOS previews

PRs from trusted authors automatically publish a signed, notarized Apple Silicon DMG to the
rolling `desktop-preview` prerelease when opened, reopened, or updated. This includes fork PRs.
Apply `preview:mac` to request another build of the current commit. The trusted workflow consumes
that label so it can be applied again; removing it does not disable automatic previews.
The label does not bypass author trust. The build is split so the Developer ID certificate never
shares a job with PR code:

- `.github/workflows/desktop-macos-preview.yml` runs on `pull_request` with no secrets and builds
  only the JS bundle from the PR (the same `js-bundle` artifact `release.yml` produces).
- `.github/workflows/desktop-macos-preview-publish.yml` runs on `workflow_run` from `main`. It
  refuses unless the PR is open, its head is the built commit, and the author is a
  bot, a collaborator, or listed in `.github/VOUCHED.td` (read from the default branch, so a PR cannot vouch
  for itself). It then packages and signs the bundle through `release-desktop.yml` checked out at
  `main`, so packaging, native helpers, and the Electron/desktop dependencies come from `main`, not
  the PR. Only the version is read from the PR commit, as data. A PR that changes packaging must use
  the `channel=preview` release train above instead.

Before handing the bundle to the signing runner, the trusted workflow validates its ZIP entries
and accepts only regular files under `server/dist` and `desktop/dist-electron`, plus the directory
entries that lead to those roots. The artifact cannot
overwrite packaging code or installed dependencies. The bundle is copied into the app, never executed,
on the signing runner. The
`pull_request_target` cleanup job in the publish workflow removes the download when the PR closes and never checks out PR code.

## `pull_request_target` policy

GitHub blocks `pull_request_target` in public repositories unless an Actions event policy allows
it. This repository's policy (`gh api repos/supabitapp/supaterm/actions/policies`, or
`/settings/actions/rules` on GitHub) allows it only for `pr-vouch.yml`, `pr-size.yml`,
`web-preview-publish.yml`, and `desktop-macos-preview-publish.yml`, none of which runs PR code. The
policy also restricts those four workflows to the events it lists. Update it before adding a
trigger to one of them or adding another `pull_request_target` workflow, or GitHub blocks those runs.
Workflows that build PR code use `pull_request`, then `workflow_run` from `main` when they need
credentials. Mobile Preview needs signing credentials in the build itself, so it runs only for
branches in this repository.

Mobile previews are opt-in to conserve Expo's upload allowance. Apply the
`🚀 Mobile Continuous Deployment` label to start previews. Later pushes reuse a recorded build
with a matching native fingerprint, compiling and uploading only when none exists. Remove the
label to stop previews on future pushes; a build already running continues.

## Required release credentials

Store `OP_SERVICE_ACCOUNT_TOKEN` in the GitHub `release` environment. Its read-only 1Password service
account needs access to the `Supacode Next CI` vault. The environment must allow `main` for manual and
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

The `cloudflare` fnox profile reads `CLOUDFLARE_API_TOKEN` from the `Supacode Next Cloudflare Hosting` item in the `Supacode Next CI` vault. The token needs Workers Scripts edit access in the configured account, plus Workers Routes edit and Zone read access for `supaterm.com`. Deployment jobs use the `release` GitHub environment. Wrangler manages the custom domains and their certificates.

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
and pair a reachable server under Settings → Connections.

## Nightly builds

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - scheduled check of `main` every four hours at 00:08, 04:08, 08:08, 12:08, 16:08, and 20:08 UTC (`8 */4 * * *`)
  - manual `workflow_dispatch` with `channel=nightly`
- Automatic nightlies require commits ahead of the latest published nightly, including manual nightlies.
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
   `check_cli_publish` has run the npm publish as a dry run.
2. `publish_cli` publishes the `supaterm@<version>` launcher, which downloads from that release, on
   every channel.
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

After the GitHub Release is published, the workflow runs `node scripts/build-npm-launcher.ts`, then
`node apps/server/scripts/cli.ts publish --packages-dir npm-packages`, which runs `npm publish` on
`supaterm.tgz`. That is the only package published per release.

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
5. Nightly runs publish with npm dist-tag `nightly`; preview runs with `preview`.

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

Required fields in the `Supacode Next Apple Desktop Signing` item in the `Supacode Next CI` vault:

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
  - Check the service account can read all Apple fields in `Supacode Next CI`.
- Windows build unsigned when expected signed:
  - Check all Azure ATS and auth secrets are populated and non-empty.
- Build fails with signing error:
  - Release macOS jobs require their fnox profile to resolve; use the unsigned PR preview workflow for an unsigned build.
  - Re-check certificate/profile names and tenant/client credentials.
