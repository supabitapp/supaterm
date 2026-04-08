---
name: supaterm-start-linear-task
description: Start work on a Linear issue in a separated Git worktree and a fresh Codex session. Use when the user asks to start working on implementing a Linear ticket.
---

# Start Linear Task In Supaterm

## Workflow

1. Resolve the Linear issue identifier from the user request. If the identifier is ambiguous, stop and ask for it.
2. Choose the launch target from the user request:
   - Default to a new tab when the user does not mention panes.
   - Use a new pane only when the user explicitly asks for a pane.
3. Run the launcher:

```bash
.agents/skills/supaterm-start-linear-task/scripts/start-linear-task-in-supaterm.sh SUP-34 # default, in tabs
.agents/skills/supaterm-start-linear-task/scripts/start-linear-task-in-supaterm.sh SUP-34 --pane
.agents/skills/supaterm-start-linear-task/scripts/start-linear-task-in-supaterm.sh SUP-34 --pane
```
