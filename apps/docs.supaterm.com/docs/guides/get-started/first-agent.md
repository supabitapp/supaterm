---
title: Connect your first coding agent
description: Enable a coding-agent integration and verify its status in Supaterm.
---

Supaterm integrates with Claude, Codex, and Pi. Install the agent itself before enabling its Supaterm integration.

## Enable the integration

1. Open **Supaterm > Settings > Coding Agents**.
2. Turn on the agent you use.
3. Resolve any availability or version message shown below the agent.
4. Start the agent in a Supaterm pane.

The Claude and Codex toggles install Supaterm-managed hooks in the agent's user configuration. Pi uses its Supaterm extension package.

## Install the discovery skill

Install the stable skill that teaches coding agents how to discover the command guide bundled with your version of Supaterm:

```bash
sp skills install
```

Inspect the current guides with:

```bash
sp skills list
sp skills get core
sp skills get coding-agents
```

## Verify the connection

Start a task in the agent. Its tab should show running activity. Attention requests and completion appear in the sidebar; `Command-I` opens the agent panel for progress and workspace details.

If no status appears, run `sp diagnostic` in the same pane and open [coding-agent setup](/guides/coding-agents/setup).
