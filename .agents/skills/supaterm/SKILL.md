---
name: supaterm
description: Use to create terminal tabs and panes if running within Supaterm through `sp tab new` and `sp pane split`. Trigger this skill when you need to open a new tab in a space or split an existing pane in a direction.
---

## `ping`

Before any command, run `sp internal ping` to see if the socket is live first.

## `tab new`

- Use `sp tab new --json ...` to create a tab.
- Inside Supaterm, omit `--in` to create the tab in the current space.
- Outside Supaterm, pass `--in <space>`.
- Pass `--cwd <path>` to start the tab in a specific working directory.
- Pass `--shell <script>` to run a raw shell script, including multiple commands.
- Pass `--focus` to focus the new tab after creating it.
- Append a command to run immediately in the new tab.
- Use `sp ls --json` to discover selectors and UUIDs.

```bash
sp tab new --json
sp tab new --json --focus -- ping 1.1.1.1
sp tab new --json --shell $'echo 1\necho 2'
sp tab new --json --in 1 --cwd ~/tmp -- git status
```

## `pane split`

- Use `sp pane split --json right|left|up|down ...` to split a pane.
- Inside Supaterm, omit `--in` to split the current pane.
- Outside Supaterm, pass `--in <space/tab>` or `--in <space/tab/pane>`.
- Pass `--shell <script>` to run a raw shell script, including multiple commands.
- Pass `--cwd <path>` to start the new pane in a specific working directory.
- Pass `--layout keep` to preserve the existing pane sizing.
- Append a command to run immediately in the new pane.
- Use `sp ls --json` to discover selectors and UUIDs.

```bash
sp pane split --json right
sp pane split --json down -- htop
sp pane split --json down --shell $'echo 1\necho 2'
sp pane split --json --in 1/2 left
sp pane split --json --in 1/2/1 down -- tail -f /tmp/server.log
```
