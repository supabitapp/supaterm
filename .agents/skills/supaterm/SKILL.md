---
name: supaterm
description: Use to interact with Supaterm the window/space/tab/pane tree, create tabs or panes, send notifications.
---

# Supaterm

Use `sp` for normal interaction. Avoid hand-writing socket JSON unless the task is specifically about debugging the protocol or the CLI itself.

## Inspect the app first

- Run `sp tree --json` to inspect the window, space, tab, and pane hierarchy.

## Change the app through `sp`

- Create a tab with `sp new-tab --json --focus ...`.
- Create a pane with `sp new-pane --json right|left|up|down ...`.

## Respect the targeting rules

- `new-tab` accepts `--space` and optional `--window` when targeting outside the current pane.
- `new-pane` and `notify` require `--space` together with `--tab` when targeting outside the current pane.
- `--pane` requires `--tab`.
- `--window` requires `--space`.
- If `new-tab`, `new-pane`, or `notify` runs outside Supaterm without the required hierarchy target, the CLI fails instead of inventing one.
