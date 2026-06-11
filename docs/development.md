# Development

## Bootstrap

Initialize submodules from the repo root:

```bash
git submodule update --init --recursive
```

Install pinned tools:

```bash
mise install
```

Authenticate Tuist before using cache-backed generation:

```bash
mise exec -- tuist auth login
mise exec -- tuist auth whoami
```

Warm the macOS Tuist cache:

```bash
make mac-warm-cache
```

Use `$SUPATERM_CLI_PATH` in development shells to call the Debug CLI instead of the installed app CLI:

```bash
"$SUPATERM_CLI_PATH" diagnostic
```

## Isolated App State

`make mac-run` creates disposable state and zmx directories under `apps/mac/.build/run-state` by default. To reuse a specific development state root:

```bash
SUPATERM_RUN_STATE_HOME=/tmp/supaterm-dev make mac-run
```

To reuse a named development instance:

```bash
SUPATERM_RUN_INSTANCE_NAME=supaterm-dev SUPATERM_RUN_STATE_HOME=/tmp/supaterm-dev make mac-run
```

Panes inherit `SUPATERM_STATE_HOME`, so `sp` commands launched inside the app use the same root.

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.
