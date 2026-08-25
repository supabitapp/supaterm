---
title: Create your first space
description: Organize a Project with a Space, pinned Tabs, and split panes.
---

A space is the top-level container for one area of work. Use separate spaces for projects or contexts that should not share a tab list.

## Create and name the space

Click the **+** button at the bottom of the sidebar, or open the command palette and choose **Create Space**. Give it a short name such as `Supaterm`.

You can also create and focus one from a terminal. These examples use `jq` to retain the IDs returned by `sp`:

```bash
space_id="$(sp space new --json Supaterm | jq -r '.target.spaceID')"
```

Creating the space displays it in this window, but the shell that ran the command keeps its original pane context. Retain the new ID for the next commands.

Right-click a space to rename or delete it. Supaterm always keeps at least one space.

## Add a Project and Tab

Create an app-wide Project, then create its Tab in the new Space. A Project root becomes the default cwd when you omit `--cwd`:

```bash
sp project add Supaterm --root ~/code/supaterm --color blue
tab="$(sp tab new --json --in "$space_id" --project Supaterm --focus)"
pane_id="$(printf '%s' "$tab" | jq -r '.paneID')"
```

You can also create Projects from selected Tabs in the sidebar. Drag a Tab onto a Project header to assign it, or onto the Unassigned header to clear membership. Right-click a Project to rename, color, collapse, pin, create a Tab, or remove it. Removing a non-empty Project asks for confirmation and closes all its Tabs across the app.

## Split the tab

Press `Command-D` to split right or `Command-Shift-D` to split down. From the CLI:

```bash
sp pane split --in "$pane_id" right
```

The new pane inherits the current working directory unless you provide another one. See [spaces, tabs, and panes](/guides/terminal-workflow/spaces-tabs-panes) for navigation and layout controls.
