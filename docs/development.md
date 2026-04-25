# Development

When running the app in development, to use the right CLI path for use `$SUPATERM_CLI_PATH` to avoid running into the production cli in /Applications

```
$SUPATERM_CLI_PATH diagnostic
```

## Manual App Checks

For UI-facing changes, use the `cua-driver` skill to launch Supaterm and exercise the app before handing off. 

Snapshot the target window before and after each action, click around non-destructively, and save screenshots for the states touched.

## Warm Cache

Warm the macOS Tuist cache from the repo root with:

```bash
mise exec -- tuist auth login
mise exec -- tuist auth whoami
make mac-warm-cache
```

This warms the cacheable Debug graph for tagged internal and external dependencies.

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.
