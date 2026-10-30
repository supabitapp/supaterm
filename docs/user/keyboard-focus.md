# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat or to the previous control on other pages.
With [threads side by side](./thread-sidebar.md#open-threads-side-by-side), that is the
focused pane's composer, and shortcuts and paste act in that pane. Click a pane or press
`mod+alt+1` through `mod+alt+4` to focus another.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between workspace areas

On web and desktop, use `F6` and `Shift+F6` to cycle through the sidebar, conversation,
composer, and visible panels. Each area restores its last focused control. In a browser that
uses F6 for its toolbar, use `mod+F6` and `mod+Shift+F6`. Customize the workspace focus commands
in **Settings → Keybindings**.

In the sidebar, Up and Down focus threads, Enter opens one, and Left and Right collapse or
expand groups. `F2` renames a thread; `Shift+F10` opens its context menu. In Settings, arrow
keys move between sections and Enter opens one. Dialogs retain their own focus.
