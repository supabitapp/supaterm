---
name: supaterm
description: Use to create tabs and panes in Supaterm through `sp new-tab` and `sp new-pane`. Trigger this skill when Codex needs to open a new tab in a space or split an existing pane in a direction.
---

# Supaterm

Use `sp` for normal interaction. Avoid hand-writing socket JSON unless the task is specifically about debugging the protocol or the CLI itself.

## `new-tab`

- Use `sp new-tab --json --focus ...` to create a tab.
- Inside Supaterm, omit `--space` to create the tab in the current space.
- Outside Supaterm, pass `--space <n>`.
- Pass `--window <n>` only together with `--space <n>`.
- Pass `--cwd <path>` to start the tab in a specific working directory.
- Append a command to run immediately in the new tab.

```bash
sp new-tab --json --focus
sp new-tab --json --space 1 --focus zsh
sp new-tab --json --space 1 --window 1 --cwd ~/tmp git status
```

## `new-pane`

- Use `sp new-pane --json right|left|up|down ...` to split a pane.
- Inside Supaterm, omit hierarchy flags to split the current pane.
- Outside Supaterm, pass `--space <n>` and `--tab <n>`.
- Pass `--pane <n>` only together with `--tab <n>`.
- Pass `--window <n>` only together with `--space <n>`.
- Keep `--focus` when the new pane should become active.
- Append a command to run immediately in the new pane.

```bash
sp new-pane --json right
sp new-pane --json down htop
sp new-pane --json --space 1 --tab 2 left
sp new-pane --json --space 1 --tab 2 --pane 1 down tail -f /tmp/server.log
```
