# Testing

[AGENTS.md](../../AGENTS.md#verifying) owns the test rules and commands. Apply them when writing
or reviewing a change: extend an existing case or table, and test the lowest layer that exposes
the regression. Ask for a missing test only when it would catch a concrete behavior failure.

Logic, persistence, protocol, and permission changes need focused regression coverage. Purely
visual changes use before/after captures. Do not request static-markup, callback-wiring, or
repeated wrapper assertions. Keep shared behavior tests in the shared package rather than
copying them into each client.

For event-sourced work, await the persisted milestone or drain the effect worker. Timeouts,
retries, sleeps, and polling cannot replace a deterministic completion signal.
