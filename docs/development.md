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
make mac-run            # Debug run with isolated ephemeral state
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
make mac-test-ui        # Run UI tests against the real app
```

E2E tests in `apps/mac/supatermE2E` spawn their own `supaterm.app` with a fresh instance name, state home, and `ZMX_DIR`, then control it through the `sp` socket protocol. They never attach to a running development or user instance.

UI tests in `apps/mac/supatermUITests` launch an isolated app through XCTest and exercise user-visible behavior. They run through the `supatermUITests` scheme locally and in the `mac-test-ui` GitHub workflow.

Use `$SUPATERM_CLI_PATH` inside Supaterm panes to call the Debug CLI injected by the running app instead of an installed `sp`:

Note: Avoid running UI test locally, run it on CI instead.

```bash
"$SUPATERM_CLI_PATH" diagnostic
```

Useful diagnostics:

```bash
"$SUPATERM_CLI_PATH" instance ls
"$SUPATERM_CLI_PATH" diagnostic --json
"$SUPATERM_CLI_PATH" config validate
```

## Versioning

Supaterm uses Calendar Versioning for public releases: `YY.release.patch`.

- Use `regular` for the first release of a year and normal feature releases. The first 2026 release after `1.3.7` is `26.0.0`; the next regular 2026 release is `26.1.0`.
- Use `hotfix` for patch-only follow-ups within the current release line. A hotfix after `26.1.0` is `26.1.1`.
- `MARKETING_VERSION` is the public version shown in the app, changelog, tags, GitHub releases, and Sparkle short version.
- `CURRENT_PROJECT_VERSION` is a private monotonic build number. Stable CI publishes `CURRENT_PROJECT_VERSION * 1000`; tip CI publishes `CURRENT_PROJECT_VERSION * 1000 + github.run_number`.

Run stable releases from the repo root:

```bash
make bump-and-release
```

## Isolated App State

`make mac-run` creates disposable state and zmx directories under `apps/mac/.build/run-state` by default. To reuse a specific development state root:

```bash
SUPATERM_RUN_STATE_HOME=/tmp/supaterm-dev make mac-run
```

To reuse a named development instance and make `sp --instance` stable:

```bash
SUPATERM_RUN_INSTANCE_NAME=supaterm-dev SUPATERM_RUN_STATE_HOME=/tmp/supaterm-dev make mac-run
```

`make mac-run` accepts these runtime overrides:

- `SUPATERM_RUN_ID` controls the disposable run directory suffix.
- `SUPATERM_RUN_INSTANCE_NAME` becomes `SUPATERM_INSTANCE_NAME` for the app process.
- `SUPATERM_RUN_STATE_HOME` becomes `SUPATERM_STATE_HOME` for the app process and spawned panes.
- `SUPATERM_RUN_ZMX_DIR` becomes `ZMX_DIR` for the app process.

All Makefile app launch targets set `SUPATERM_VERBOSE_LOGGING=1`, so development runs always emit verbose diagnostics.

Panes inherit Supaterm context from the running app:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_CLI_PATH`
- `SUPATERM_STATE_HOME` when an app state root is configured
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`
- `ZMX_DIR`, `ZMX_SESSION`, and `ZMX_SESSION_PREFIX` when zmx sessions are enabled (the default)

The app also prepends the bundled CLI directory to pane `PATH`.

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
