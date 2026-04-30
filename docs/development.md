# Development

Use `$SUPATERM_CLI_PATH` in development shells to call the Debug CLI instead of the installed app CLI:

```bash
"$SUPATERM_CLI_PATH" diagnostic
```

## Isolated App State

`SUPATERM_STATE_HOME` is the root for settings, sessions, spaces, pinned tabs, launch state, and terminal config. Use it with `make mac-run` to avoid touching production app state:

```bash
SUPATERM_STATE_HOME=/tmp/supaterm-dev make mac-run
```

For a disposable run:

```bash
SUPATERM_STATE_HOME="$(mktemp -d)" make mac-run
```

Panes inherit `SUPATERM_STATE_HOME`, so `sp` commands launched inside the app use the same root.

## Warm Cache

Warm the macOS Tuist cache from the repo root with:

```bash
mise exec -- tuist auth login
mise exec -- tuist auth whoami
make mac-warm-cache
```

This warms external dependencies for Debug.

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.
