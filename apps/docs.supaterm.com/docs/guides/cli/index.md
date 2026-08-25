---
title: CLI quickstart
description: Control Supaterm Projects, Spaces, Tabs, panes, settings, and coding-agent workflows with sp.
---

`sp` is the command-line interface bundled with Supaterm. Every pane gets the matching binary on `PATH` and receives enough context to target its owning app, tab, and pane.

## Inspect Supaterm

```bash
sp ls
sp diagnostic
sp instance ls
```

`sp ls` prints one compact live snapshot with typed `s:`, `j:`, `t:`, and `p:` refs. Add `--json` for the Project catalog and a flat item list with canonical UUIDs, Project IDs, parent IDs, cwd, and coding-agent state.

Resolve a project icon from the current directory or a given project root:

```bash
sp project icon
sp project icon ~/code/project --json
```

This command reads local icon declarations first, then common icon paths. It needs no running Supaterm app.

## Create terminal surfaces

```bash
space_id="$(sp space new --json Work | jq -r '.target.spaceID')"
sp project add Development --root ~/code/project --color blue
tab="$(sp tab new --json --in "$space_id" --project Development --focus --script 'git status')"
pane_id="$(printf '%s' "$tab" | jq -r '.paneID')"
sp pane split --in "$pane_id" right -- npm test
```

Inside Supaterm, unscoped commands use the caller pane's original context. Changing UI focus does not change that context, so chained commands should retain IDs and pass explicit [targets](/guides/cli/targeting). These examples use `jq` to extract typed IDs from JSON output.

When only the new pane UUID is needed, avoid JSON parsing:

```bash
pane_id="$(sp pane split --plain --in "$pane_id" right)"
```

`--script` starts the account login shell, enters visible text, and returns to that same shell when the script ends. This keeps the tab alive for the commands that use its IDs. Arguments after `--` instead launch a process directly with exact arguments and the caller's `PATH`, skip shell startup, and close the tab or pane when the process exits.

## Control a pane

```bash
sp pane send --newline 'echo hello'
sp pane capture --scope scrollback --lines 100
sp pane health
sp pane wait-ready --timeout 5
```

## Discover the version-matched guide

```bash
sp skills list
sp skills get core
sp skills get core --full
```

The bundled guide is authoritative for the installed version. `--full` includes the complete Project, Space, Tab, pane, agent, selector, and diagnostic references.

## Output modes

Most commands support:

- `--json` for structured output
- `--plain` for stable unstyled text
- `--quiet` to suppress successful output
- `--no-color` to keep human-readable output unstyled

Use exit status, not output text, to decide whether a command succeeded.

Continue with [targeting](/guides/cli/targeting) and [automation recipes](/guides/cli/recipes).
