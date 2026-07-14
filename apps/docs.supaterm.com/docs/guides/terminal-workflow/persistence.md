---
title: Restore layouts and sessions
description: Understand layout restoration, zmx process persistence, and close behavior.
---

Supaterm separates the saved layout from the processes running inside that layout.

## Restore Terminal Layout

With **Settings > General > Restore Terminal Layout** enabled, Supaterm reopens the previous windows, spaces, tabs, split trees, and working directories after relaunch.

The saved layout does not by itself keep a shell or command alive.

## Persist Sessions Using zmx

With **Persist Sessions Using zmx** enabled, terminal processes can continue while Supaterm restarts. On relaunch, restored panes attach to their surviving sessions.

This setting is enabled by default and requires an app restart after it changes.

## Close behavior

Persistence protects an app restart, not an intentional close:

- Closing a pane terminates that pane's terminal session.
- Closing a tab terminates all panes in the tab.
- Closing a window terminates the terminal sessions in that window.
- Quitting and reopening Supaterm can restore zmx-backed sessions when both persistence settings are enabled.

Supaterm can ask for confirmation before closing a running surface. Configure this under **Settings > Terminal > Close Confirmation**.

## Coding-agent state

When the underlying process is still the same, Supaterm can restore recorded agent lifecycle and panel state. The restored session becomes actionable again after the agent sends a fresh native event. Do not treat layout restoration as a replacement for the agent's own resume or fork command.
