---
title: Connect your first coding agent
description: Install Supaterm's skill, enable optional hooks, and verify agent status.
---

Supaterm supports Claude, Codex, and Pi. Install the agent first.

## Set up Supaterm

For Claude or Codex, install the skill and set up hooks with one command:

```bash
sp agent setup
```

For Pi, which needs no hooks, install only the skill:

```bash
sp skills install
```

Both commands copy the skill to `~/.agents/skills/supaterm` and link it at
`~/.claude/skills/supaterm` for Claude.

Inspect the current guides with:

```bash
sp skills list
sp skills get core
sp skills get coding-agents
```

## Enable optional hooks

1. Open **Supaterm > Settings > Coding Agents**.
2. Turn on Claude or Codex if you use it.
3. Resolve any availability or version message shown below the agent.
4. Start the agent in a Supaterm pane.

The toggles install the skill before Supaterm-managed hooks in the agent's user configuration. Pi
needs no hook setup and uses terminal detection only.

## Verify the connection

Start a task in the agent. Its tab should show Working when Supaterm can match its state. Claude and Codex can also show Needs input and unseen completion. `Command-I` opens the agent panel.

If no status appears, run `sp diagnostic` in the same pane and open [coding-agent setup](/guides/coding-agents/setup).
