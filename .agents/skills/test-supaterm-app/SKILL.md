---
name: test-supaterm-app
description: Test Supaterm's web and desktop UI through its built-in Browser panel against isolated development state. Use for browser verification, browser pairing recovery, and test fixtures. Use test-supaterm-mobile for native mobile verification.
---

# Test Supaterm web and desktop

Use Supaterm's built-in Browser panel for verification. If its tools are absent or
the panel reports unavailable, explain the blocker and stop verification.
Do not install or switch to another automation system. For native mobile
testing, use [test-supaterm-mobile](../test-supaterm-mobile/SKILL.md).

## Start the app

Reuse this task's healthy dev server. Otherwise run `vp run dev` from the
repository root and retain its terminal session. In the main checkout, pass
`--home-dir "$PWD/.supaterm"`; its default home is the live install. Use the worktree's ignored
`.supaterm` state and read the actual ports and pairing URL from the dev-runner output.
Never run against `~/.supaterm/userdata` or set `VITE_HTTP_URL` or `VITE_WS_URL`.

Test with meaningful project and thread data. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) only when
inspecting or seeding SQLite. Stop the test server before direct fixture writes.

## Exercise agent turns

Use `Replay (dev)` for streaming and turn rendering without paid model usage.
Open its picker with `Ctrl+Alt+Shift+R` and select a scenario such as `showcase`.
Use a real provider when testing its protocol or model behavior. Keep the
requested provider, model, and options when the task specifies them.

## Use the Browser panel

Call `preview_status`, then `preview_open` if the Browser panel is
closed. Navigate to the complete startup pairing URL once with
`preview_navigate`, then use `preview_snapshot` and Supaterm's interaction tools.
If the token was consumed or expired, run `node apps/server/src/bin.ts pair --no-relay`
for a fresh one. Keep using the same tab.

## Verify and retain

Exercise the affected flow and capture the state that proves it works. Keep
the server, state, and panel available while the user inspects or iterates.
An assistant turn ending is not teardown. Stop only processes you started,
using retained terminal sessions or captured PIDs.

When sharing is requested, start with `vp run dev --share` and give the user
a fresh complete pairing URL that you have not consumed. Keep other credentials
out of screenshots, commits, and replies.
