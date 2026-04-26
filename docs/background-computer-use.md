# Background Computer Use

This is heavily inspired by the amazing work from Cua team https://github.com/trycua/cua/blob/main/blog/inside-macos-window-internals.md

Supaterm's computer-use path lets `sp` inspect and control macOS app windows through the running Supaterm app process. The app process owns Accessibility, Screen Recording, window lookup, element caching, and input dispatch. The CLI only sends typed socket requests.

The source remains authoritative for current command flags and payload shapes.

## Contract

- Commands target a process ID and, for window-scoped operations, a window ID.
- Window IDs come from `sp computer-use windows`.
- Element indices come from the latest `sp computer-use snapshot` for the same process and window.
- A snapshot refresh replaces the cached element map for that process/window pair.
- Actions return an `ok`, `dispatch`, and optional `warning`.
- Background control is best effort across apps because macOS still routes some behavior through app-specific responder chains.

## Permissions

`sp computer-use permissions` reports:

- Accessibility
- Screen Recording

Snapshots and accessibility actions require Accessibility. Screenshots require Screen Recording unless the snapshot mode avoids image capture.

## Basic Flow

```bash
sp computer-use permissions
sp computer-use launch --bundle-id com.apple.TextEdit
sp computer-use windows --app TextEdit --on-screen-only --json
sp computer-use snapshot --pid 123 --window 456 --image-out /tmp/window.png --json
sp computer-use click --pid 123 --window 456 --element 3
```

`launch` sets `NSWorkspace.OpenConfiguration.activates = false` and restores the previous frontmost app if LaunchServices still activates the target.

## Snapshot

`snapshot` can run in three modes:

- `som`: accessibility elements plus screenshot
- `ax`: accessibility elements only unless `--image-out` is provided
- `vision`: screenshot only

The default mode comes from Supaterm settings. `--query` filters returned elements without renumbering them, so an `elementIndex` remains stable for the cached snapshot.

## Click Dispatch

Element clicks first try Accessibility when the request can map to a single AX action:

- single unmodified clicks use the requested element action, defaulting to `AXPress`
- right press maps to `AXShowMenu`
- double left click maps to `AXOpen` only when the element advertises `AXOpen`

For single unmodified element clicks, Supaterm tries the resolved AX action even when the element does not advertise it. If it succeeds, the result uses `dispatch: "accessibility"` and may include `warning: "action_not_advertised"`. If a selected AX action fails, Supaterm returns `action_failed` and does not silently retry as a pixel click.

If the AX path cannot handle the request and the element has a target point, Supaterm falls back to a pixel click:

- active target app: HID event
- inactive left single/double click without modifiers: SkyLight pid-targeted event
- other inactive clicks: pid-targeted CoreGraphics event

Coordinate clicks always use the pixel path. `--x` and `--y` are window screenshot coordinates.

## Focus Behavior

Computer-use actions should not intentionally steal foreground focus.

For AX actions, Supaterm sets synthetic accessibility focus on the target window/element, performs the action, then restores the previous AX focus state. The focus guard also enables manual/enhanced Accessibility on apps that support it and registers an AX observer so those changes settle before action dispatch.

Some apps still activate themselves when an AX action runs. During guarded actions, Supaterm records the previous frontmost app, listens for target-app activation, and reactivates the previous app if the target steals foreground focus.

For pixel clicks in background windows, Supaterm uses pid-targeted event delivery where available. The SkyLight path also sends a focus-without-raise event to the target window before posting the mouse event.

## Text, Key, Scroll, Set Value

- `type --element` first tries to set `AXSelectedText` on the element. If that fails, it focuses the element synthetically and falls back to pid-targeted keyboard events.
- `type` without an element posts each character to the target pid.
- `key` posts a key down/up pair to the target pid.
- `scroll` maps direction/unit to keyboard navigation and posts those key events.
- `set-value` sets `AXValue`. Popup buttons are handled by pressing a matching child option.

Keyboard-backed actions can still fail on apps that require a real active key window or a specific responder chain.
