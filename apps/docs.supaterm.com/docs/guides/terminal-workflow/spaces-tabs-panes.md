---
title: Spaces, groups, tabs, and panes
description: Organize terminal work with spaces, optional tab groups, and split panes.
---

Supaterm keeps terminal work in a simple hierarchy: spaces contain tabs and optional tab groups, groups contain tabs, and tabs contain panes.

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

## Groups and tabs

Tabs belong to the selected space. They can remain at the root or sit inside a named, colored group. Create a tab with `Command-T`, then drag it to reorder it, move it into a group, remove it from a group, or combine it with another root tab in a new group.

Use **New Group** at the bottom of the outline to create an empty group and rename it immediately. A group keeps its identity when empty, can be renamed, colored, collapsed, pinned, ungrouped, or closed, and persists across relaunches. Ungrouping promotes its tabs to the space root. Closing it closes every contained tab.

Pinning applies to a whole root item. Pinning a tab inside a group first removes it from the group and then pins it at the root. Pinned and regular root items retain their relative order in one outline.

Right-click a tab to rename, move, pin, close, close other tabs, or close the tabs below it. The first ten tabs in flattened outline order are available through `Command-1` to `Command-0`; collapsed groups do not change that order.

```bash
sp tab new --focus --cwd "$PWD"
sp group new Development --color blue
sp tab move --group Development
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

Run `sp ls` for a readable tree with typed short refs. Use `sp ls --json` for a flat snapshot with canonical UUIDs, parent IDs, cwd, and coding-agent state. Items preserve the same root order shown in the sidebar:

```bash
sp ls
sp ls --json
```

Use short refs for live work and UUIDs in durable scripts. See [targeting](/guides/cli/targeting) for the exact rules.
