---
title: Appearance and terminal themes
description: Configure Supaterm chrome, Ghostty colors, fonts, and close behavior.
---

Supaterm's app chrome and terminal content use separate appearance controls.

## App appearance

Choose **Auto**, **Light**, or **Dark** under **Settings > General > Appearance**. Auto follows the macOS appearance.

## Terminal themes

Under **Settings > Terminal**, choose separate Ghostty themes for light and dark appearance. You can also choose the font and a font size from 6 to 72 points.

Supaterm reads and writes the active Ghostty config. The settings page shows its resolved path. Supaterm preserves config lines it does not manage and updates only:

- `theme`
- `font-family`
- `font-size`
- `confirm-close-surface`

If the config uses included files, Supaterm edits only the primary file. Some changes require an app restart.

## Custom themes

Put user Ghostty themes in:

```text
~/.config/ghostty/themes
```

Reopen Settings after adding a theme, then select it for light or dark appearance.

Supaterm's sidebar and window chrome have one built-in visual system. Ghostty themes change terminal content, not the surrounding chrome.
