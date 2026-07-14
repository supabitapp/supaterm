---
title: Spaces, tabs, and panes
description: Organize terminal work and navigate Supaterm's three-level hierarchy.
---

Supaterm keeps terminal work in a simple hierarchy: spaces contain tabs, and tabs contain panes.

## Spaces

Use a space for an area of work that needs its own tab list. The space bar at the bottom of the sidebar lets you create and switch spaces. Right-click a space to rename or delete it.

Keyboard shortcuts `Control-1` through `Control-0` select the first ten spaces. CLI equivalents include:

```bash
sp space new --focus Work
sp space focus 1
sp space next
sp space prev
sp space last
```

## Tabs

Tabs belong to the selected space. Create a tab with `Command-T`, then drag it within the sidebar to reorder it. Dragging between the pinned and regular sections also pins or unpins the tab.

Right-click a tab to rename, pin, close, close other tabs, or close the tabs below it. The first ten tabs are available through `Command-1` to `Command-0`.

```bash
sp tab new --focus --cwd "$PWD"
sp tab rename Build
sp tab pin
sp tab next
```

## Panes

Split a tab when related processes should stay visible together:

```bash
sp pane split right
sp pane split down --cwd ~/code/project -- npm test
```

Use the **Splits** menu or command palette to focus and resize panes. `Command-Shift-Return` zooms the selected pane without changing the split tree.

Available CLI layouts are:

```bash
sp pane layout equalize
sp pane layout tile
sp pane layout main-vertical
```

## Inspect the hierarchy

Run `sp ls` for a readable tree or `sp ls --json` for selectors and stable UUIDs:

```bash
sp ls
sp ls --json
```

Use the UUIDs in durable scripts. See [targeting](/guides/cli/targeting) for selector rules.
