# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat,
or to the previous control on other pages. Choosing a workspace focus command moves to that
area instead. Opening Pull requests moves focus into that page.
With [threads side by side](./thread-sidebar.md#open-threads-side-by-side), the composer is the
focused pane's, and shortcuts and paste act in that pane. Click a pane or press
`mod+alt+1` through `mod+alt+4` to focus another.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
In pickers and search fields with suggestions, Tab chooses the highlighted suggestion, the same
as Enter, unless the field uses Tab itself, such as completing a folder path. With nothing
highlighted, Tab moves focus as usual.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between workspace areas

On web and desktop, press `F6` or `Shift+F6` to move between the Threads sidebar,
conversation, message input, and visible panels. With threads side by side, each pane's
conversation, message input, and panels are their own stops, in pane order, and moving into a
pane focuses it. Navigation wraps around and restores the last focused control in each area. Pull requests has a page content area. In Settings,
`F6` moves between the section list and the open section. Hidden areas are skipped. Other
dialogs and form popups retain focus; a thread context menu closes when an area command
moves focus away.

In a browser, plain `F6` may move to the browser's own toolbar. Use `mod+F6` and
`mod+Shift+F6` instead (`mod` is Command on macOS and Ctrl elsewhere). **Focus Next
Workspace Area** and **Focus Previous Workspace Area** are also in the command palette and
can be remapped in Settings > Keybindings.

## Browse threads

Tab enters the sidebar once. Up and Down move between threads without opening them; Enter
opens the focused thread or toggles a group. Right and Left expand and collapse groups.
Tab moves from the focused thread to its buttons. `F2` renames the focused thread.

Press `Shift+F10` or the Context Menu key to open the focused thread's menu. Use the arrow
keys to move through it, Enter to choose, and Escape to close it.

The Settings section list works the same way: Up and Down move between sections, and Enter
opens one.
