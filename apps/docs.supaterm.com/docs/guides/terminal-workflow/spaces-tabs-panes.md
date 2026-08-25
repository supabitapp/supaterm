---
title: Projects, Spaces, Tabs, and panes
description: Organize terminal work with app-wide Projects, Spaces, Tabs, and split panes.
---

Projects organize related Tabs across the app. Spaces keep separate Tab lists in each window. A Tab may belong to one Project and contains one or more panes.

## Spaces

Use a space for an area of work that needs its own tab list. The space bar at the bottom of the sidebar lets you create and switch spaces. Right-click a space to rename or delete it.

Keyboard shortcuts `Control-1` through `Control-0` select the first ten spaces. CLI equivalents include:

```bash
sp space new Work
sp space focus 1
sp space next
sp space prev
sp space last
```

## Projects and Tabs

Tabs belong to the selected Space. A Tab may belong to an app-wide, named Project or remain Unassigned. Create a Tab with `Command-T`, then drag it to reorder it, assign it to a Project, or clear its membership.

Create a Project from selected Tabs with the existing sidebar action. Project headers support inline rename, color, collapse, pin, Tab creation, and drag reorder. Empty Project sections stay hidden in a Space, but the Project remains available through `sp project list`. Removing a non-empty Project asks for confirmation and closes all assigned Tabs in every Space and window.

Projects and Tabs have separate pin lanes. Project pinning changes section order. Tab pinning keeps that Tab before regular Tabs within its section and does not change membership.

Right-click a Tab to rename, assign, unassign, pin, close, close other Tabs, or close the Tabs below it. The first ten Tabs in semantic section order are available through `Command-1` to `Command-0`; collapsed sections do not change that order.

```bash
sp tab new --focus --cwd "$PWD"
sp project add Development --root "$PWD" --color blue
sp tab move --project Development
sp tab move --unassigned
sp tab rename Build
sp tab pin
sp tab next
```

A new tab with no command starts the account login shell. **New Supaterm Tab Here** starts one in the chosen folder.

Arguments after `--` launch an executable directly with the caller's `PATH` and preserve every argument exactly. This skips shell startup files, and the tab closes when the executable exits. Use `--script` for builtins, aliases, or raw shell code. Supaterm starts the account login shell and enters the script visibly. The same shell remains after the script ends.

## Panes

Split a tab when related processes should stay visible together:

```bash
sp pane split right
sp pane split down --cwd ~/code/project -- npm test
```

A split with no command starts the account login shell.

Panes use the same launch modes as tabs. Arguments after `--` run directly with exact arguments and close the pane on exit. `--script` enters visible text in the account login shell and returns to that same shell when the script ends.

Use the **Splits** menu or command palette to focus and resize panes. `Command-Shift-Return` zooms the selected pane without changing the split tree.

Available CLI layouts are:

```bash
sp pane layout equalize
sp pane layout tile
sp pane layout main-vertical
```

## Inspect the hierarchy

Run `sp ls` for a readable tree with typed short refs and derived Project headings. Use `sp ls --json` for the global Project catalog plus a flat item snapshot with canonical UUIDs, Project IDs, parent IDs, cwd, and coding-agent state:

```bash
sp ls
sp ls --json
```

Use short refs for live work and UUIDs in durable scripts. See [targeting](/guides/cli/targeting) for the exact rules.
