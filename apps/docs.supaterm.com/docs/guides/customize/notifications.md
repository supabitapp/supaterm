---
title: Notifications
description: Configure macOS delivery, pane attention, unread badges, and terminal notifications.
---

Supaterm can surface terminal and coding-agent activity in the sidebar, inside the pane, and through macOS.

## System notifications

Enable **Settings > Notifications > System notifications** to deliver terminal and agent notifications through macOS. The first enablement can trigger a macOS permission prompt.

If delivery is enabled but nothing appears, open **System Settings > Notifications > Supaterm** and verify macOS permission.

## Glowing Pane Ring

Enable **Glowing Pane Ring** to highlight a pane when terminal or coding-agent activity needs attention.

Turning off the ring removes only the in-pane glow. Unread attention and sidebar badges remain.

## Sidebar state

The sidebar can show an unread count, a bell, an agent-attention mark, and the latest notification preview. Focusing the relevant pane acknowledges its unread state.

## Send a notification from a command

Inside Supaterm, notify the current pane:

```bash
sp pane notify --title "Build complete" --body "All checks passed"
```

Pass a pane selector or UUID to notify another pane:

```bash
sp pane notify 1/2/3 --body "Deploy complete"
```

Notification text may be visible on the lock screen according to macOS notification settings. Avoid putting secrets in titles or bodies.
