# Development

When running the app in development, to use the right CLI path for use `$SUPATERM_CLI_PATH` to avoid running into the production cli in /Applications

```
$SUPATERM_CLI_PATH diagnostic
```

## Testing

Tests that exercise polling or timeout behavior should inject a clock and advance it instead of waiting on wall clock time.

In tests, use `TestClock` from `Clocks` and call `advance(by:)` rather than sleeping for a real poll interval or timeout.
