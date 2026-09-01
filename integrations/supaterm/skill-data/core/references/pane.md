# Pane commands

`sp pane` splits, focuses, moves, closes, resizes, captures text, takes screenshots, checks
readiness, notifies, and sends text or keys to panes.

## Split

`sp pane split <direction>` creates a new pane beside the current pane when run inside Supaterm. The new pane does not take focus by default; add `--focus` to make it active. Use `--in` to target a tab or pane explicitly.

```bash
sp pane split right
sp pane split --focus right
sp pane split down -- htop
sp pane split down --script 'echo hi; pwd'
sp pane split --layout keep right
sp pane split --in 1/2 left
sp pane split --in <tab-uuid> left
sp pane split --in 1/2/3 down -- tail -f /tmp/server.log
```

Flags:

- `--layout keep` preserves the existing pane sizing
- `--layout equalize` equalizes panes after splitting
- `--focus` focuses the new pane instead of using the default background behavior
- `--no-focus` explicitly leaves focus unchanged
- `--cwd <path>` sets the starting working directory
- `--script <script>` runs raw code in the login shell
- `--in <tab-or-pane>` targets a tab or pane

A split with no command starts the account login shell.

The first argument after `--` names an executable to launch directly. Supaterm resolves it with the caller's `PATH`, preserves every argument exactly, skips shell startup files, and closes the pane when the executable exits. Use `--script` for builtins, aliases, or raw shell code. Supaterm enters the text visibly in the account login shell and returns to that same shell when the script ends.

## Focus And Close

`sp pane focus` switches the window to the pane's space when the pane sits in another one.

```bash
sp pane focus
sp pane focus 1/2/3
sp pane focus <pane-uuid>

sp pane close
sp pane close 1/2/3
sp pane close <pane-uuid>
```

## Move To A New Tab

`sp pane move-to-new-tab [pane]` moves a pane out of a split into an adjacent tab and focuses it.
The pane must share its current tab with another pane.

```bash
sp pane move-to-new-tab
sp pane move-to-new-tab 1/2/3
sp pane move-to-new-tab <pane-uuid>
```

The pane keeps its UUID. Commands run inside it still use that UUID after the move.

## Send Text

`sp pane send` sends literal text. It accepts an optional pane target first, or stdin.

```bash
sp pane send --newline 'echo hello'
sp pane send 1/2/3 'pwd'
sp pane send <pane-uuid> 'clear'
sp pane send 1/2/3 -
printf 'pwd' | sp pane send
```

Use `-` to read the text argument from stdin.

Use `--submit` to paste the complete text and then press Enter as a separate input event:

```bash
sp pane send --submit <pane-uuid> - < prompt.txt
```

Use `--newline` only to append a literal newline. Do not use it to submit multiline prompts to an interactive coding agent.

## Send Key

`sp pane key <key> [pane]` sends one key event. It targets the current pane when run inside
Supaterm unless you pass a pane target.

```bash
sp pane key ctrl-c
sp pane key enter 1/2/3
sp pane key escape <pane-uuid>
```

Supported keys: `backspace`, `ctrl-c`, `ctrl-d`, `ctrl-l`, `ctrl-z`, `enter`, `escape`, and `tab`.

## Capture

`sp pane capture` captures visible output by default, or scrollback with `--scope scrollback`.

```bash
sp pane capture
sp pane capture --scope scrollback --lines 200
sp pane capture --json <pane-uuid>
```

## Screenshot

`sp pane screenshot` saves a pane as a PNG, including one hidden in another space or tab. The
command does not change the selected space, tab, pane, or application focus.

```bash
sp pane screenshot --output pane.png
sp pane screenshot 1/2/3 --output pane.png
sp pane screenshot <pane-uuid> -o pane.png --json
```

## Health And Readiness

`sp pane health` reports whether a pane is ready for input. `sp pane wait-ready` waits until readiness is true or the timeout expires. A pane stays ready while its space is off screen; the report also says whether the window shows it.

```bash
sp pane health <pane-uuid> --json
sp pane wait-ready <pane-uuid> --timeout 5
```

## Resize

`sp pane resize <direction> <amount> [pane]` resizes a pane by cell count.

```bash
sp pane resize right 10
sp pane resize down 5 1/2/3
sp pane resize left 8 <pane-uuid>
```

## Layout

`sp pane layout <mode> [tab]` applies a layout to a tab.

Supported modes:

- `equalize`
- `tile`
- `main-vertical`

Examples:

```bash
sp pane layout equalize
sp pane layout tile 1/2
sp pane layout main-vertical <tab-uuid>
```

## Notify

`sp pane notify` sends a Supaterm notification for a pane.

```bash
sp pane notify --body "All tests passed"
sp pane notify --title "Deploy complete"
sp pane notify --subtitle "Production" --body "Deploy complete"
sp pane notify 1/2/3 --body "Deploy complete"
sp pane notify <pane-uuid> --body "Deploy complete"
```

## Output

Mutating `pane` commands support the standard output flags:

```bash
sp pane split --json right
sp pane focus --plain 1/2/3
sp pane move-to-new-tab --json <pane-uuid>
sp pane key ctrl-c <pane-uuid>
sp pane close --quiet 1/2/3
```
