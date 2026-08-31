---
title: Set up coding agents
description: Enable Claude, Codex, or Pi integration and install Supaterm's agent skill.
---

Supaterm can track Claude, Codex, and Pi when they run inside its panes. Basic activity works without hook setup when Supaterm can identify the foreground agent. This terminal-only state is temporary and read-only. It does not create notifications or session actions.

Enable the native integration for Claude and Codex session actions or Pi lifecycle state. The terminal sets Claude and Codex phase while their hooks add only session identity and workspace data. Pi reports its full lifecycle through its native integration.

## Before you begin

Install the agent and make sure its executable is available from your login shell. The native Codex integration requires version 0.144.1 or newer.

## Enable an integration

Open **Supaterm > Settings > Coding Agents** and turn on the agent. Supaterm reports whether the integration is unavailable, incomplete, changed from its managed configuration, or healthy.

- Claude installs managed hooks in `~/.claude/settings.json`.
- Codex enables supported hooks, writes `~/.codex/hooks.json`, and registers the required trust through Codex's public app-server API. Its hook command uses the absolute path to Supaterm's bundled `sp`, so hooks do not depend on runtime `HOME`, `PATH`, or `SUPATERM_CLI_PATH`.
- Pi installs the Supaterm package through Pi. It does not use the Claude and Codex settings-file bridge.

Supaterm preserves unrelated settings in those files. Turning Codex off removes its hooks and native trust. Supaterm recognizes old bundled `sp` paths and its old environment-based command so repair and removal still work after an app move or upgrade.

![Supaterm coding-agent settings with Claude, Codex, and Pi enabled.](/images/settings-coding-agents-enabled-dark.png)

## Command-line setup

Install the discovery skill used by coding agents:

```bash
sp skills install
```

Install every supported hook bridge:

```bash
sp agent install-hooks
```

Pi is normally managed from Settings. Its package can also be installed directly:

```bash
pi install git:github.com/supabitapp/supaterm-skills
```

## Update existing scripts

Replace per-agent hook commands with the aggregate commands:

| Previous command               | Replacement              |
| ------------------------------ | ------------------------ |
| `sp agent install-hook claude` | `sp agent install-hooks` |
| `sp agent install-hook codex`  | `sp agent install-hooks` |
| `sp agent remove-hook claude`  | `sp agent remove-hooks`  |
| `sp agent remove-hook codex`   | `sp agent remove-hooks`  |

For detection troubleshooting, replace `sp agent explain` with `sp diagnostic --json` for the
current pane and `sp ls --json` for pane status across the live tree. Detailed rule evaluation is
no longer part of the public CLI.

## Verify

Start the agent inside Supaterm and begin a task. The tab should show Working, then Done or Needs input as its state changes. If no status appears, see [troubleshooting](/guides/troubleshooting#coding-agent-status-does-not-appear).
