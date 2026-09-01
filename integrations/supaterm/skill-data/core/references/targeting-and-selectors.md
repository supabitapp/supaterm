# Targeting and selectors

Use `sp ls` as the compact live snapshot. Human and plain output show typed short refs. JSON returns canonical UUIDs for durable automation.

```bash
sp ls
sp ls --json
sp ls --plain
sp ls --instance work-mac
```

## Ambient Targeting

When a command runs inside Supaterm, many commands can omit their target:

- `sp space focus` uses the space this window displays
- `sp tab focus` uses the current tab
- `sp group collapse` uses the group containing the current tab
- `sp pane focus` uses the current pane
- `sp tab new` creates a tab beside the current tab, joining its group or creating one for both tabs
- `sp pane split` splits the current pane

That ambient context comes from:

- `SUPATERM_SOCKET_PATH`
- `SUPATERM_SURFACE_ID`
- `SUPATERM_TAB_ID`

`SUPATERM_SOCKET_PATH` chooses the app socket. `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID` choose the pane or tab target after the socket is connected.

They also choose the window. Space commands, and `sp tab new --in <space>`, act on the window that owns that pane or tab, switching it in place and leaving every other window alone. Outside Supaterm the key window is used instead.

## Selector Forms

- Space selector: `1`
- Tab selector: `1/2`
- Pane selector: `1/2/3`
- Space ref: `s:a6e57b1b`
- Group ref: `g:5a52445e`
- Tab ref: `t:6bfc889d`
- Pane ref: `p:2b8b3a57`

Typed refs contain 8 to 32 case-insensitive UUID hex characters. Supaterm prints lowercase refs with the shortest unique prefix for that kind, never fewer than eight characters. Repeated rows with the same UUID share one ref and do not count as collisions. Prefixes can grow when another live item collides. Longer valid refs work.

The CLI resolves each typed ref from a fresh live snapshot and sends the canonical UUID. Missing, malformed, wrong-kind, and ambiguous refs fail. Ambiguity errors list the full matching typed refs. Typed tokens never fall back to titles.

Short refs and numeric selectors reflect live topology. Use canonical UUIDs from JSON or creation output when identity must survive later calls. Full UUIDs work anywhere the matching typed ref works.

Space indexes follow the shared space order, the same order as `sp space ls` and the switcher dots, so `1` means the same space in every window. Tab and pane selectors are read inside the window the command acts on, because tabs belong to one window.

Groups have no numeric selector. Tab selectors remain flat across the displayed root order, so group membership does not add another component.

An untyped group target can be an exact title. Titles resolve only within the ambient or targeted space and fail when duplicated there.

## Listing JSON

`sp ls --json` returns one flat snapshot:

```json
{
  "revision": "a6cd3174dc5d64f2",
  "current": {
    "windowIndex": 1,
    "spaceID": "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497",
    "tabID": "6BFC889D-2D0F-4675-924E-B15A6A4E372B",
    "paneID": "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A"
  },
  "items": [
    {
      "kind": "pane",
      "id": "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A",
      "parentID": "6BFC889D-2D0F-4675-924E-B15A6A4E372B",
      "windowIndex": 1,
      "title": "build",
      "cwd": "/code/project",
      "selected": true,
      "agent": {
        "kind": "codex",
        "phase": "running",
        "phaseSource": "native",
        "sessionID": "019ffa6a-8555-74d0-876d-c153c46353bb"
      },
      "agentStatus": "resolved"
    }
  ]
}
```

Items appear in window, space, root, and child order. Each item has `kind`, canonical `id`, `windowIndex`, `title`, and `selected`. Children add `parentID`. Panes can add `cwd`, `agent`, and `agentStatus`. Spaces add `isWarm`.

`agentStatus` says how coding-agent detection stands for the pane: `resolved` when an agent is identified, otherwise why not (`waiting`, `unrecognized_process`, `no_foreground_process`, `no_rule_match_or_settling`, `screen_unavailable`, `detection_disabled`). `agent` carries `kind`, `phase` (`unknown`, `idle`, `running`, `needs_input`), and `phaseSource` (`native` when an integration supplies fallback state, `screen` when terminal rules do), plus `sessionID` and `ruleID` when known. `sp diagnostic` adds the agent's process id. Read `agentStatus` first when a pane that should run an agent shows none.

When present, `current` has `windowIndex`, `spaceID`, `tabID`, and optional `paneID`. `revision` is an opaque live snapshot token. Compare it for equality; it is not a counter or schema version.

JSON contains no derived short-ref or numeric-selector fields. The same space UUID may appear once per window because each window owns different tabs in that space. Use `(windowIndex, kind, id)` for a space occurrence and join parent rows within the same window.

A space with `isWarm: false` has not been opened in that window yet in this run. Its tabs, panes, IDs, and saved pane cwd come from the saved layout. It has no live terminal or agent state. `sp space focus` or `sp tab new --in <space>` opens it first.

## Creation JSON

Creation commands return typed IDs instead:

```bash
sp tab new --json
```

```json
{
  "spaceID": "BBBDD2AB-3F53-4BCA-B120-CE4A5E8C7F18",
  "tabID": "3734DE02-672F-4914-95DE-35D093CE1B3A",
  "paneID": "5E6E9773-222B-468A-AA65-11341F2926FF",
  "spaceIndex": 2,
  "tabIndex": 1,
  "paneIndex": 1
}
```

Use `tabID` or `paneID` from creation output when chaining follow-up commands like `sp pane split --in <tabID>` or `sp pane send <paneID> ...`.

Use `--plain` instead of `--json` when only the new pane UUID is needed:

```bash
sp tab new --plain
sp pane split --plain right
```

## `--in`

Targeted creation commands use `--in`:

- `sp tab new --in <space>` resolves the space inside the window the command runs in and opens its saved tabs first when needed. Add `--focus` to switch that window to the space as well.
- `sp group new <title> --in <space>`
- `sp pane split --in <tab>`
- `sp pane split --in <pane>`

With no trailing command or `--script`, the new tab or pane starts the account login shell.

The first argument after `--` on `sp tab new` and `sp pane split` names an executable to launch directly. Supaterm resolves it with the caller's `PATH`, preserves all arguments exactly, skips shell startup files, and closes the tab or pane when the executable exits.

Use `--script` for builtins, aliases, or raw code for the account login shell to parse. Supaterm enters the text visibly and returns to that same shell after the script ends.

Examples:

```bash
sp tab new --in 1 --cwd ~/tmp --script 'git status'
sp tab new --in <space-uuid> --focus -- ping 1.1.1.1
sp group new Build --in <space-uuid>
sp pane split --in 1/2 left
sp pane split --in 1/2/3 down -- tail -f /tmp/server.log
sp pane split --in <tab-uuid> right
sp pane split --in <pane-uuid> up
```

## Target Rules By Family

- `space` commands accept a space target and act on the window they run in
- `group` commands accept a group target in the relevant space
- `tab focus`, `tab close`, and `tab rename` accept a tab target
- `tab move` accepts a tab target, then requires a group or root destination
- `tab next`, `tab prev`, and `tab last` accept an optional space target
- `pane focus`, `pane move-to-new-tab`, `pane close`, `pane capture`, `pane resize`, and `pane notify` accept a pane target
- `pane split` accepts a tab or pane target through `--in`
- `pane layout` accepts an optional tab target
- `pane send` accepts an optional pane target as its first argument
- `pane key` accepts an optional pane target after the key

## Outside Supaterm

Outside Supaterm, omit ambient assumptions and pass an explicit target. If more than one app instance is reachable, also pass `--instance` or `--socket`.

```bash
sp tab new --in 1
sp pane split --in 1/2 right
sp tab focus 1/2
sp pane focus 1/2/3
sp pane capture --instance work-mac 1/2/3
```
