---
name: core
description: Core Supaterm CLI guide for controlling spaces, tab groups, tabs, panes, selectors, diagnostics, settings, licensing, and coding-agent integrations with `sp`. Read this before running Supaterm commands.
---

# Supaterm core

Use `sp` to control Supaterm from a terminal already running inside Supaterm. Run `sp skills get coding-agents` before launching or prompting a coding agent.

## Terminology

- Space: the top-level container, users might use this to separate work / life profile. Spaces are shared across windows: a space has one name, color, and position in the list, and every window can display it.
- Group: an ordered collection of tabs inside a space
- Tab: a terminal tab inside a space. Tabs belong to one window and one space, so the same space holds different tabs in each window.
- Pane: a split terminal region inside a tab

A window displays one space at a time and switches in place. Space commands switch the window they
run in and never open, close, or touch another window.

## Fast Start

Show setup commands and diagnostics:

```bash
sp onboard
sp diagnostic
sp instance ls
```

Inspect the live topology and copy a typed short ref:

```bash
sp ls
```

Use `sp ls --json` when durable automation needs canonical UUIDs.

Resolve the first project icon:

```bash
sp project icon
sp project icon ~/code/project --json
```

Inspect the license without exposing its key:

```bash
sp license
```

Creation commands use typed JSON keys instead of a generic `id`:

```bash
sp tab new --json
# => { "spaceID": "...", "tabID": "...", "paneID": "...", ... }

sp pane split --json right
# => { "spaceID": "...", "tabID": "...", "paneID": "...", ... }
```

`sp tab new --plain` and `sp pane split --plain right` print the new pane UUID for direct chaining.

List, create, and display spaces:

```bash
sp space ls
sp space new Work
sp space focus 1
```

Create, focus, and pin tabs:

```bash
sp tab new --focus
sp tab focus 1/2
sp tab pin 1/2
sp tab unpin 1/2
```

Create a group and place tabs in it:

```bash
sp group new Build --color blue
sp tab new --group Build
sp tab move 1/2 --group Build
sp group collapse Build
```

Omit both a trailing command and `--script` to start the account login shell.

The first argument after `--` names an executable to launch directly. Supaterm resolves it with the caller's `PATH`, preserves all arguments exactly, skips shell startup files, and closes the tab or pane when the executable exits.

Use `--script` for builtins, aliases, or raw code for the account login shell to parse. Supaterm enters the text visibly and returns to the same shell after the script ends.

```bash
sp tab new --script 'printf "ready\n"; pwd'
```

Read JSON creation output for `tabID` and `paneID`. Capture the pane later with its UUID or a live `p:` ref: `sp pane capture --scope scrollback --lines 160 <pane-target>`.

Save any rendered pane as a PNG with `sp pane screenshot <pane-uuid> --output pane.png`.

Split panes and send shell commands:

Splits leave focus unchanged by default. Add `--focus` when the new pane should become active.

```bash
sp pane split down -- htop
sp pane split --layout keep right
sp pane send --newline 'echo hello'
sp pane key ctrl-c
```

`--newline` is for shell input. For coding-agent prompts, load `sp skills get coding-agents` and use `--submit`.

## Deep-Dive References

Load every reference:

```bash
sp skills get core --full
```

Resolve the version-matched directory when reading one reference directly:

```bash
sp skills path core
```

- [Connection and diagnostics](references/connection-and-diagnostics.md)
- [Project commands](references/project.md)
- [Targeting and selectors](references/targeting-and-selectors.md)
- [Space commands](references/space.md)
- [Group commands](references/group.md)
- [Tab commands](references/tab.md)
- [Pane commands](references/pane.md)
- [License commands](references/license.md)
- [Agent commands](references/agent.md)
