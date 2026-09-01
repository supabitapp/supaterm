# Space commands

`sp space` lists, creates, displays, renames, recolors, destroys, and navigates spaces.

A space is shared: one name, one color, one position in the list, visible to every window. Tabs are
not shared: each window keeps its own tabs inside each space. A window displays one space at a time.

Every `sp space` command acts on one window, the one the command runs in. Outside Supaterm that is
the key window. A space command switches that window in place and never opens, closes, or changes
another window.

## List

`sp space ls` lists every space in order with the index used by space selectors. `*` marks the space
this window displays. `cold` means this window has not opened that space yet in this run, so its
tabs come from the saved layout and its panes have no live terminal until the window displays the
space or a command targets one of its tabs or panes.

```bash
sp space ls
sp space ls --json
sp space ls --plain
```

## Create

`sp space new <name>` adds a space to the shared list, gives it a first tab, and displays it in this
window. It never opens a window. `--color` sets the space color; a random color is used when the
flag is omitted. Creation fails without leaving an empty space when the name is invalid or already
used.

```bash
sp space new Work
sp space new --color green Work
```

## Focus

`sp space focus [space]` switches this window to a space in place. Inside Supaterm, omitting the
target uses the space this window displays. Space indexes follow the order in `sp space ls`, which
is the order of the switcher dots, and mean the same thing in every window.

```bash
sp space focus
sp space focus 1
sp space focus <space-uuid>
```

## Rename

`sp space rename <name> [space]` renames a space. The new name shows in every window.

```bash
sp space rename Work
sp space rename Logs 1
sp space rename Build <space-uuid>
```

## Color

`sp space color <color> [space]` sets a space's color, used for its window chrome and its switcher
dot. Colors: neutral, red, orange, yellow, green, blue, pink, purple. Neutral removes the tint.

```bash
sp space color green
sp space color purple 1
sp space color neutral <space-uuid>
```

## Destroy

`sp space destroy -y [space]` destroys a space everywhere. It kills that space's tabs in every
window, and any window displaying it falls back to the neighboring space. No window closes. Omit
`-y` to confirm interactively; the prompt counts the panes it would kill across all windows.

```bash
sp space destroy -y
sp space destroy -y 1
sp space destroy -y <space-uuid>
```

## Navigate

Navigation moves this window through the list in place. `last` returns to the space this window
displayed before the current one.

```bash
sp space next
sp space prev
sp space last
```

## Output

Mutating `space` commands support the standard output flags:

```bash
sp space new --json Work
sp space focus --plain 1
sp space destroy -y --quiet 1
```
