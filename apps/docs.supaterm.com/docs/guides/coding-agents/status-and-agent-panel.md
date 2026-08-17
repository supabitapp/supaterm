---
title: Agent status and panel
description: Read coding-agent activity, progress, workspace context, and notifications.
---

Supaterm keeps agent activity visible without replacing the terminal.

## Sidebar status

The tab row reflects the foreground agent sessions across its panes:

- **Working** — the agent is processing a turn or using tools.
- **Needs input** — a permission request, question, or other attention event is waiting.
- **Done** — a turn finished while its tab was not being viewed.

Needs input takes priority over Done, and Done takes priority over Working. Viewing the tab clears Done. A turn that finishes in the tab you are viewing does not show Done. Wide rows show the symbol and word; narrow rows show only the symbol.

Native hooks supply the full lifecycle and remain authoritative. Without them, fallback detection can show basic temporary activity for a recognized foreground agent. Fallback state is read-only and creates no notifications or session actions.

Unread badges and notification previews remain available after activity ends. Viewing a tab clears its completion state. Hover a tab row to read the latest agent response from its focused pane without switching tabs. Tabs with no response do not show a hover card.

## Agent panel

Press `Command-I` in an agent pane. When the integration supplies the data, the panel can show:

- plan progress
- active child agents and their latest detail
- the agent's workspace directory
- Git branch and changed-line counts
- pull request state and checks
- local web services discovered from listening ports in the agent process tree

Click the directory or branch row to copy its full value. Pull requests, checks, and local service rows open their URLs.

![Supaterm agent panel showing progress, workspace, pull request checks, artifacts, and session actions.](/images/agent-panel-branch-pr-checks-dark.png)

The panel follows the foreground root agent. A child agent cannot replace its parent's workspace or session actions.

Fallback detection can supply the agent identity and basic activity state. Native hooks add lifecycle, plan, child-agent, final-response, and session data. Fallback data is not saved.

## Attention

Enable **Settings > Notifications > Glowing Pane Ring** to highlight a pane that needs attention. Enable **System notifications** for macOS delivery.

Turning either presentation off does not discard unread state or badges. See [notifications](/guides/customize/notifications).
