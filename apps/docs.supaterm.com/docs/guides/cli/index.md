---
title: CLI quickstart
description: Control Supaterm spaces, tabs, panes, settings, and coding-agent workflows with sp.
---

`sp` is the command-line interface bundled with Supaterm. Every pane gets the matching binary on `PATH` and receives enough context to target its owning app, tab, and pane.

## Inspect Supaterm

```bash
sp ls
sp diagnostic
sp instance ls
```

`sp ls` prints the current window, space, tab, and pane tree. Add `--json` for stable IDs and machine-readable output.

## Create terminal surfaces

```bash
space_id="$(sp space new --json --focus Work | jq -r '.target.spaceID')"
tab="$(sp tab new --json --in "$space_id" --focus --cwd ~/code/project -- git status)"
pane_id="$(printf '%s' "$tab" | jq -r '.paneID')"
sp pane split --in "$pane_id" right -- npm test
```

Inside Supaterm, unscoped commands use the caller pane's original context. Changing UI focus does not change that context, so chained commands should retain IDs and pass explicit [targets](/guides/cli/targeting). These examples use `jq` to extract typed IDs from JSON output.

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

The bundled guide is authoritative for the installed version. `--full` includes the complete space, tab, pane, agent, selector, and diagnostic references.

## Output modes

Most commands support:

- `--json` for structured output
- `--plain` for stable unstyled text
- `--quiet` to suppress successful output
- `--no-color` to keep human-readable output unstyled

Use exit status, not output text, to decide whether a command succeeded.

Continue with [targeting](/guides/cli/targeting) and [automation recipes](/guides/cli/recipes).
