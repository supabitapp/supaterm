---
title: Create your first space
description: Organize a project with a space, tabs, pinned tabs, and split panes.
---

A space is the top-level container for one area of work. Use separate spaces for projects or contexts that should not share a tab list.

## Create and name the space

Click the **+** button at the bottom of the sidebar, or open the command palette and choose **Create Space**. Give it a short name such as `Supaterm`.

You can also create and focus one from a terminal. These examples use `jq` to retain the IDs returned by `sp`:

```bash
space_id="$(sp space new --json --focus Supaterm | jq -r '.target.spaceID')"
```

`--focus` changes the visible space, but the current shell keeps its original pane context. Retain the new ID for the next commands.

Right-click a space to rename or delete it. Supaterm always keeps at least one space.

## Add a project tab

Create a tab in the new space and start it in your project:

```bash
tab="$(sp tab new --json --in "$space_id" --focus --cwd ~/code/supaterm)"
pane_id="$(printf '%s' "$tab" | jq -r '.paneID')"
```

Right-click the tab to rename or pin it. Pinned tabs stay in a dedicated section above regular tabs and keep their pane layout.

## Split the tab

Press `Command-D` to split right or `Command-Shift-D` to split down. From the CLI:

```bash
sp pane split --in "$pane_id" right
```

The new pane inherits the current working directory unless you provide another one. See [spaces, tabs, and panes](/guides/terminal-workflow/spaces-tabs-panes) for navigation and layout controls.
