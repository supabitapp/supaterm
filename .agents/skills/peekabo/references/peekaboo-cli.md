# Peekaboo CLI reference

## Install and run

```bash
bunx @steipete/peekaboo permissions
```

## Permissions

```bash
peekaboo permissions status
peekaboo permissions grant
```

## Discover targets

```bash
peekaboo list
peekaboo list windows --app "Safari"
peekaboo list screens --json-output
```

## Capture UI maps

```bash
peekaboo see --app "Safari" --json-output
peekaboo see --mode screen --retina --path /tmp/see.png --json-output
```

Extract a snapshot ID and element candidates:

```bash
peekaboo see --app "Safari" --json-output | jq -r '.data.snapshot_id'
peekaboo see --app "Safari" --json-output | jq '.data.ui_elements[] | select(.label | test("Reload"; "i"))'
```

## Click and type

```bash
peekaboo click --on B12 --snapshot <snapshot_id>
peekaboo click "Reload" --snapshot <snapshot_id>
peekaboo type "hello" --return --snapshot <snapshot_id>
```

## Keys, scrolling, and pointer

```bash
peekaboo hotkey cmd,shift,t
peekaboo press escape
peekaboo scroll --direction down --ticks 8
peekaboo move --to 1200,800
```

## Windows and apps

```bash
peekaboo window list --app "Safari"
peekaboo window focus --app "Safari" --space-switch
peekaboo window resize --app "Safari" -w 1200 --height 800
peekaboo app list
peekaboo app launch "Notes"
```

## Menus, menubar, dock, spaces

```bash
peekaboo menu list --app "Safari"
peekaboo menu click --app "Safari" --path "File > New Window"
peekaboo menubar list
peekaboo menubar click --index 3
peekaboo dock list
peekaboo dock launch "Notes"
peekaboo space list
peekaboo space switch --to 2
```

## Screenshots and analysis

```bash
peekaboo image --mode screen --retina --path /tmp/screen.png
peekaboo image --app "Safari" --window-title "Release Notes" --format jpg --path /tmp/release-notes.jpg
```

## Scripted runs

```bash
peekaboo run /tmp/flow.peekaboo.json --output /tmp/flow-result.json --no-fail-fast
```

Example `.peekaboo.json` flow:

```json
{
  "description": "Safari focus smoke",
  "steps": [
    {
      "stepId": "focus_safari",
      "command": "app",
      "params": {
        "generic": {
          "_0": {
            "name": "Safari",
            "action": "focus"
          }
        }
      }
    },
    {
      "stepId": "see_frontmost",
      "command": "see",
      "params": {
        "generic": {
          "_0": {
            "mode": "frontmost",
            "path": "/tmp/flow-see.png",
            "annotate": "false"
          }
        }
      }
    }
  ]
}
```

## Troubleshooting checklist

- Run `peekaboo permissions status` and fix missing Screen Recording or Accessibility.
- Re-run `peekaboo see` to refresh a stale snapshot before clicking or typing.
- Scope commands with `--app`, `--window-title`, or `--window-id` when multiple windows exist.
- Add `--json-output` or `--verbose` to surface details.
