---
name: peekabo
description: Use when working with the Peekaboo CLI or MCP server to capture macOS screens, inspect UI elements, and automate GUI interactions (see/click/type/scroll/hotkey/window/menu/dock/space), or when troubleshooting Peekaboo permissions, snapshots, or focus issues.
---

# Peekabo

## Overview

Use Peekaboo to see the macOS UI, capture screenshots, and drive deterministic interactions through element IDs and snapshots.

## Installation

```
bunx @steipete/peekaboo
npx -y @steipete/peekaboo
brew install steipete/tap/peekaboo
```

Priority is in that order.

## Workflow

1. Verify permissions.
   - Run `peekaboo permissions status` before any capture or interaction.
2. Identify targets.
   - Use `peekaboo list` or `peekaboo window list --app <Name>` to find apps and windows.
3. Capture a snapshot.
   - Run `peekaboo see --app <Name> --json-output` and keep `snapshot_id`.
4. Act on elements.
   - Prefer element IDs from `see` with `click`, `type`, `scroll`, `drag`, `hotkey`, `press`.
   - Use coordinates only when IDs are unavailable.
5. Validate.
   - Re-run `see` or `image` to confirm UI state after actions.
6. Escalate to agent when needed.
   - Use `peekaboo agent "task"` for multi-step natural language flows.

## Quick start

```bash
peekaboo permissions status
peekaboo list
peekaboo see --app "Safari" --json-output
peekaboo click --on B12
peekaboo type "hello" --return
peekaboo image --mode screen --retina --path ~/Desktop/screen.png
```

## Decision rules

- Use `see` + element IDs for reliable clicks and typing.
- Always scope actions with `--app`, `--window-title`, or `--window-id` when multiple windows exist.
- Use `--json-output` for scripting and to extract snapshot and element IDs.
- If a command fails due to focus or stale snapshots, run `see` again and retry with the new snapshot.

## References

- Use `references/peekaboo-cli.md` for command summaries, flags, and examples.
