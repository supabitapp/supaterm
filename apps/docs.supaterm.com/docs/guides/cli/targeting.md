---
title: Target instances, spaces, tabs, and panes
description: Use ambient context, selectors, UUIDs, instances, and sockets safely.
---

Targeting has two independent steps: choose a running Supaterm instance, then choose an object inside its terminal hierarchy.

## Ambient context

Inside a Supaterm pane, these variables select the owning app and current terminal:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`
- `SUPATERM_CLI_PATH`

This makes the common commands concise:

```bash
sp tab new
sp pane split right
sp pane send --newline 'pwd'
```

Ambient IDs belong to the shell process. Focusing another space, tab, or pane does not rewrite them. Capture IDs from `--json` output and pass `--in` when one command creates the target for the next.

## Selectors

Public selectors are 1-based paths through the current hierarchy:

| Object | Form             | Example |
| ------ | ---------------- | ------- |
| Space  | `space`          | `1`     |
| Tab    | `space/tab`      | `1/2`   |
| Pane   | `space/tab/pane` | `1/2/3` |

```bash
sp space focus 1
sp tab focus 1/2
sp pane focus 1/2/3
```

Indexes can change when objects move or close. Use UUIDs for durable automation.

## Discover UUIDs

```bash
sp ls --json
```

Creation commands return typed IDs:

```bash
sp tab new --json -- git status
sp pane split --json right
```

Space creation returns `spaceID` under `target`. Tab and pane creation return their typed IDs at the top level. Pass the relevant UUID to later commands.

## Target creation with `--in`

```bash
sp tab new --in 1 --cwd ~/code/project
sp pane split --in 1/2 right
sp pane split --in 1/2/3 down
```

`sp tab new --in` accepts a space. `sp pane split --in` accepts a tab or pane. Each also accepts the corresponding UUID.

## Choose an app instance

Outside Supaterm, the CLI uses the only reachable instance. It refuses to guess when several are reachable.

Only Supaterm panes receive the bundled CLI on `PATH` automatically. For a standard Applications install, add its directory to an external shell before using the examples below:

```bash
export PATH="/Applications/supaterm.app/Contents/Resources/bin:$PATH"
```

```bash
sp instance ls
sp ls --instance work-mac
sp pane capture --instance work-mac 1/2/3
```

`--instance` accepts an instance name or endpoint ID. `--socket` accepts an exact socket path and takes precedence. When names are duplicated, use the endpoint ID from `sp instance ls --json`.
