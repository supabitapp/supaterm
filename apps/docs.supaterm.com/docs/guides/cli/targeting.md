---
title: Target instances, Projects, Spaces, Tabs, and panes
description: Use ambient context, selectors, UUIDs, Project names, instances, and sockets safely.
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

Ambient IDs belong to the shell process. Focusing another space, tab, or pane does not rewrite them. Capture IDs from `--json` output, or the new pane UUID from creation `--plain` output, and pass `--in` when one command creates the target for the next.

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

`sp ls` also prints typed live refs:

| Object  | Form         | Example      |
| ------- | ------------ | ------------ |
| Space   | `s:<prefix>` | `s:a6e57b1b` |
| Project | `j:<prefix>` | `j:5a52445e` |
| Tab     | `t:<prefix>` | `t:6bfc889d` |
| Pane    | `p:<prefix>` | `p:2b8b3a57` |

The prefix has 8 to 32 UUID hex characters. Input is case-insensitive; output is lowercase. Supaterm prints the shortest unique prefix for each kind. Longer prefixes work. Missing, malformed, wrong-kind, and ambiguous refs fail instead of selecting another item. Refs describe the live snapshot; use full UUIDs for durable automation.

Project commands accept a `j:` ref, Project UUID, or exact case-insensitive Project name. Names are unique app-wide. Typed tokens never fall back to names.

```bash
sp project pin Development
sp project reorder 9D99542C-82D1-4505-B879-68F42EC0927D --index 1
sp tab move --project Development
```

## Inspect the compact snapshot

```bash
sp ls --json
```

JSON returns `revision`, optional `current`, the pinned-first `projects` catalog, and ordered flat `items`. Each item has a canonical `id`, `kind`, `windowIndex`, `title`, and selection state. Tabs may add `projectID` and `isPinned`; child rows add `parentID`. Panes can add `cwd` and `agent`; Spaces add `isWarm`. JSON contains no derived short-ref or numeric-selector fields.

The same space UUID may appear once per window because tabs belong to windows. `windowIndex` scopes each space occurrence. `revision` is an opaque live snapshot token. Compare it for equality; it is not a counter or schema version.

Creation commands return typed IDs:

```bash
sp tab new --json
sp pane split --json right
sp tab new --plain
sp pane split --plain right
```

Space creation returns `spaceID` under `target`. Tab and pane creation JSON returns typed IDs at the top level. Their plain output is the new pane UUID. Pass the relevant UUID to later commands. The tab and pane above start login shells, so both IDs remain live for follow-up commands.

## Target creation with `--in`

```bash
sp tab new --in 1 --cwd ~/code/project
sp pane split --in 1/2 right
sp pane split --in 1/2/3 down
```

`sp tab new --in` accepts a space target. `sp pane split --in` accepts a tab or pane target.

Project membership and location are separate. `sp tab new --project <project> --in <space>` chooses both. `sp tab move --project <project>` assigns an existing Tab, while `--unassigned` clears membership.

## Choose an app instance

Outside Supaterm, the CLI uses the only reachable instance. It refuses to guess when several are reachable.

Only Supaterm panes receive the bundled CLI on `PATH` automatically. For a standard Applications install, add its directory to an external shell before using the examples below:

```bash
export PATH="/Applications/supaterm.app/Contents/MacOS:$PATH"
```

```bash
sp instance ls
sp ls --instance work-mac
sp pane capture --instance work-mac 1/2/3
```

`--instance` accepts an instance name or endpoint ID. `--socket` accepts an exact socket path and takes precedence. When names are duplicated, use the endpoint ID from `sp instance ls --json`.
