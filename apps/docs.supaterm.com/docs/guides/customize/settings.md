---
title: Settings
description: Configure Supaterm from the app or the sp CLI.
---

Open **Supaterm > Settings** to configure the app.

## Sections

- **General** — app appearance, layout restoration, and session persistence.
- **Terminal** — Ghostty themes, font, font size, and close confirmation.
- **Hosts** — remote machines reached through SSH.
- **Notifications** — macOS delivery and the glowing pane attention ring.
- **Coding Agents** — agent integrations, status icons, and panel visibility.
- **Advanced** — verbose diagnostics in local OSLog.
- **About** — version, update channel, automatic updates, analytics, and crash reporting.

Stable is the production release channel. Tip checks more frequently for newer development builds. Choose the channel under **About**.

## Command-line configuration

Supaterm stores application settings in `~/.config/supaterm/settings.toml` by default. Inspect the active path and values with:

```bash
sp config path
sp config list
sp config list --changed
```

Read, change, or reset a setting:

```bash
sp config get appearance.mode
sp config set appearance.mode system
sp config reset appearance.mode
```

Validate the file after editing it directly:

```bash
sp config validate
```

Run `sp config list` for the current keys and accepted values. The CLI validates names and values before writing.

Hosts are stored as TOML arrays:

```toml
[[hosts]]
id = "build"
destination = "khoi@example.com"
ssh_arguments = ["-p", "2222"]
```

Add and remove hosts under **Settings > Hosts**. Enter one SSH argument per line, or edit the TOML array directly.
