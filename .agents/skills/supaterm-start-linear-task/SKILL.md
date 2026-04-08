---
name: supaterm-start-linear-task
description: Start work on a Linear issue in a separated Git worktree and a fresh Codex session. Use when the user asks to start working on implementing a Linear ticket.
---

# Start Linear Task On A New Tab

## Workflow

1. Resolve the Linear issue identifier from the user request. If the identifier is ambiguous, stop and ask for it.
2. Run the launcher:

```bash
.agents/skills/supaterm-start-linear-task-on-a-new-tab/scripts/start-linear-task-on-a-new-tab.sh SUP-34
```
