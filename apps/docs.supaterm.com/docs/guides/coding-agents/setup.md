---
title: Set up coding agents
description: Enable Claude, Codex, or Pi integration and install Supaterm's agent skill.
---

Supaterm can track Claude, Codex, and Pi when they run inside its panes. Basic activity works without hook setup when Supaterm can identify the foreground agent. This fallback state is temporary and read-only. It does not create notifications or session actions.

Enable the agent's native integration for richer progress, attention, workspace, and session data. Native events remain authoritative when both methods detect the same process.

## Before you begin

Install the agent and make sure its executable is available from your login shell. The native Codex integration requires version 0.144.1 or newer.

## Enable an integration

Open **Supaterm > Settings > Coding Agents** and turn on the agent. Supaterm reports whether the integration is unavailable, incomplete, changed from its managed configuration, or healthy.

- Claude installs managed hooks in `~/.claude/settings.json`.
- Codex enables supported hooks, writes `~/.codex/hooks.json`, and registers the required trust through Codex's public app-server API.
- Pi installs the Supaterm package through Pi. It does not use the Claude and Codex settings-file bridge.

Supaterm preserves unrelated settings in those files. Turning an integration off removes only Supaterm-managed configuration.

![Supaterm coding-agent settings with Claude, Codex, and Pi enabled.](/images/settings-coding-agents-enabled-dark.png)

## Command-line setup

Install the discovery skill used by coding agents:

```bash
sp skills install
```

Install every supported settings-file hook bridge, or one bridge at a time:

```bash
sp agent install-hooks
sp agent install-hook claude
sp agent install-hook codex
```

Pi is normally managed from Settings. Its package can also be installed directly:

```bash
pi install git:github.com/supabitapp/supaterm-skills
```

## Verify

Start the agent inside Supaterm and begin a task. The tab should show Working, then Done or Needs input as its lifecycle changes. If no status appears, see [troubleshooting](/guides/troubleshooting#coding-agent-status-does-not-appear).
