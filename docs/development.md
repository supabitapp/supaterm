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

Authenticate Tuist before using cache-backed generation or cache warming:

```bash
mise exec -- tuist auth login
mise exec -- tuist auth whoami
```

Secrets

Run commands that need project secrets through fnox:

```bash
mise exec -- fnox exec -- make mac-archive
```

fnox reads the `Supaterm Environment` item from the `Supaterm` 1Password vault. Keep secrets out of the interactive shell and use `fnox exec` for commands that need them.

Generate the macOS workspace:

```bash
make mac-generate
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

Useful macOS development commands:

```bash
make mac-generate       # Generate the Xcode workspace
make mac-xcode-open     # Open the Xcode workspace
make mac-build          # Debug build
make mac-run            # Debug run with isolated persistent state
make mac-inspect-dependencies # Check Tuist dependency graph hygiene
```

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

UI tests in `apps/mac/supatermUITests` control the shared macOS desktop, input focus, and pasteboards. Never run them locally. Always run them on CI

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
checkout path and a state home at `apps/mac/.build/run-state/dev`. State and sessions persist
across runs, so the next `make mac-run` reattaches the previous run's zmx sessions the same way
the shipped app does. Different checkouts derive different names, so worktrees stay isolated, and
the launch guard refuses a second concurrent run of the same checkout.

zmx sessions live in the default per-user directory. The instance hash in every session name
separates development sessions from the installed app's, and each app process reaps only its own
namespace.

For a clean slate, quit the app terminating its sessions, then delete the state home:

```bash
rm -rf apps/mac/.build/run-state/dev
```

`make mac-run` accepts these runtime overrides:

- `SUPATERM_RUN_INSTANCE_NAME` becomes `SUPATERM_INSTANCE_NAME` for the app process.
- `SUPATERM_RUN_STATE_HOME` becomes `SUPATERM_STATE_HOME` for the app process and spawned panes.

All Makefile app launch targets set `SUPATERM_VERBOSE_LOGGING=1`, so development runs always emit verbose diagnostics.

Reaping walks every state home under `apps/mac/.build/run-state`. A state home whose run still has a live `supaterm` process naming it in `SUPATERM_STATE_HOME` is left alone, so concurrent development runs survive each other. For every other state home, `apps/mac/scripts/reap-run-state.sh` kills each process group whose environment carries that run's `ZMX_DIR` and then deletes the directory. It reads the process table rather than the socket directory, because a daemon whose socket was unlinked keeps running and `zmx ls` no longer reports it.

Reaping only ever touches `apps/mac/.build/run-state`. Your own sessions in the default `/tmp/zmx-<uid>`, the sessions of `/Applications/supaterm.app`, and any run started with `SUPATERM_RUN_STATE_HOME` or `SUPATERM_RUN_ZMX_DIR` pointing outside that root are never reaped.

Panes inherit Supaterm context from the running app:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_CLI_PATH`
- `SUPATERM_STATE_HOME` when an app state root is configured
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`
- `ZMX_DIR`, `ZMX_SESSION`, and `ZMX_SESSION_PREFIX` when zmx sessions are enabled (the default)

The app also prepends its `Contents/MacOS` directory to pane `PATH`. The directory includes the matching `sp` CLI.

### SSH entry point

Supaterm keeps `ssh-env` in new terminal configs. When `ssh-env` or `ssh-terminfo` is active and the current terminal host has no Ghostty executable, the bundled shell integrations call the exact `SUPATERM_CLI_PATH` and let `sp ssh` replace itself with the user's `ssh` executable. This reuses the signed CLI already in the app bundle and cannot call an unbundled executable.

`sp ssh` owns the Supaterm route's portable `xterm-256color` default, SSH executable choice, terminal environment, and `SendEnv` rules. It does not pass `SetEnv`, so user SSH config keeps ownership of those values. Native Ghostty keeps its `+ssh` route and automatic terminfo installation, including when launched from a Supaterm pane. Supaterm does not rewrite existing terminal configs; users without either SSH feature keep their current behavior.

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

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.

When parsing Codex, Claude Code, or any coding-agent integration, inspect real JSONL files, transcript files, or hook payloads before designing parser behavior. Do not infer event shapes from UI text, source names, or assumptions.

## Misc

Icons can be pulled by using apps/mac/scripts/fetch-icon.sh if something is not available in SF Symbols. Sources: `lucide` for general glyphs, `simple-icons` for brand marks (padded so edge-to-edge glyphs survive template rasterization), e.g. `./scripts/fetch-icon.sh simple-icons github`
