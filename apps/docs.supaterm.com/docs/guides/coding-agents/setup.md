---
title: Set up coding agents
description: Install Supaterm's agent skill and enable Claude or Codex hooks.
---

Supaterm tracks Claude, Codex, and Pi when they run inside its panes. Basic activity works without hook setup when Supaterm can identify the foreground agent. This terminal-only state is temporary and read-only. It does not create notifications or session actions.

Claude and Codex hooks add session identity and workspace data. Pi uses terminal detection only and needs no managed integration.

## Before you begin

Install the agent and make sure its executable is available from your login shell. The native Codex integration requires version 0.144.1 or newer.

## Install the discovery skill

Install the same skill for every supported agent:

```bash
sp skills install
```

Supaterm copies it to `~/.agents/skills/supaterm`, which Pi and other agents that support the Agent Skills paths read directly.

## Enable Claude or Codex hooks

Open **Supaterm > Settings > Coding Agents** and turn on the agent. Supaterm reports whether the integration is unavailable, incomplete, changed from its managed configuration, or healthy.

- Claude installs managed hooks in `~/.claude/settings.json`.
- Codex enables supported hooks, writes `~/.codex/hooks.json`, and registers the required trust through Codex's public app-server API.

Supaterm preserves unrelated settings in those files. Turning an integration off removes only Supaterm-managed configuration.

![Supaterm coding-agent settings with Claude and Codex enabled.](/images/settings-coding-agents-enabled-dark.png)

## Command-line setup

Set up both managed hook integrations:

```bash
sp agent setup
```

Setup installs the Claude and Codex hook bridges. It also adds these defaults:

```json
{
  "terminalProgressBarEnabled": true
}
```

Supaterm adds `terminalProgressBarEnabled` to `~/.claude/settings.json`.

```toml
[tui]
terminal_title = ["activity", "thread-title", "task-progress"]
```

Supaterm adds `tui.terminal_title` to `~/.codex/config.toml`. It writes each default only when the
key is absent, so existing values stay unchanged. The command prints progress for each agent and is
safe to run again.

## Update existing scripts

Replace per-agent hook commands with the aggregate commands:

| Previous command               | Replacement             |
| ------------------------------ | ----------------------- |
| `sp agent install-hooks`       | `sp agent setup`        |
| `sp agent install-hook claude` | `sp agent setup`        |
| `sp agent install-hook codex`  | `sp agent setup`        |
| `sp agent remove-hook claude`  | `sp agent remove-hooks` |
| `sp agent remove-hook codex`   | `sp agent remove-hooks` |

For detection troubleshooting, replace `sp agent explain` with `sp diagnostic --json` for the
current pane and `sp ls --json` for pane status across the live tree. Detailed rule evaluation is
no longer part of the public CLI.

## Verify

Start the agent inside Supaterm and begin a task. Claude and Codex can show Working, Done, or Needs input. Pi shows Working when Supaterm can match its terminal state. If no status appears, see [troubleshooting](/guides/troubleshooting#coding-agent-status-does-not-appear).
