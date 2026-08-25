---
title: Sidebar and command palette
description: Navigate activity, tabs, spaces, and actions without leaving the keyboard.
---

The sidebar is Supaterm's overview of the active window. The command palette is the fastest route to any action.

## Read the sidebar

Each tab row can show:

- its title and working directory
- an unread count or notification preview
- terminal progress and bell activity
- a coding-agent running or attention state
- a shortcut hint for the first ten tabs

Non-empty Project sections appear in pinned-first catalog order, followed by Unassigned. Pinned Tabs precede regular Tabs inside each section. Project headers show the stored name, a root-derived icon or color marker, and can collapse without changing semantic Tab order. Spaces sit at the bottom. Update and release cards appear above the Space bar when relevant.

Click a row to focus it, middle-click a Tab to close it, or right-click for Tab and Project actions. Drag a Tab onto a Project header to assign it without changing its pin lane. Drop at a row gap to adopt that lane and position. Drag onto Unassigned to clear membership. Drag a Project header to pin, unpin, or reorder the app-wide catalog.

Toggle the sidebar with `Command-S`.

## Use the command palette

Press `Command-Shift-P`, then type part of an action, space, tab, or pane name. Results include:

- Supaterm window, space, tab, and pane actions
- Ghostty terminal actions and their configured shortcuts
- switch-to-space and switch-to-tab entries
- pin, unpin, and rename actions
- update actions when an update is available

Navigate with the arrow keys or `Control-P` and `Control-N`. Press Return to run the selected action and Escape to close the palette. Hold Command to reveal `Command-1` through `Command-9` quick selection for the visible results.

Because Ghostty bindings are loaded dynamically, the palette reflects your current terminal configuration instead of a fixed list.
