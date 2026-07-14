---
title: Security and privacy
description: Understand Supaterm's local control, agent access, saved state, notifications, and telemetry controls.
---

Supaterm runs terminals and coding agents with your macOS user account. Its automation is intentionally powerful, so access follows the trust you place in local processes and agents.

## Local terminal control

Each Supaterm process owns a Unix domain socket scoped to the current user. Panes receive the owning socket path, pane ID, tab ID, and bundled CLI path through environment variables.

`sp` can send input, capture terminal output and scrollback, create or close terminal surfaces, and deliver notifications. A process or coding agent with access to your user session and Supaterm socket can use those capabilities. Review scripts and skills before running them.

## Coding-agent integrations

Enabling an integration changes the agent's user configuration:

- Claude: `~/.claude/settings.json`
- Codex: `~/.codex/hooks.json` and native hook trust
- Pi: Pi's package configuration

Supaterm-managed hooks send lifecycle data and pane context to the local app. For supported agents, Supaterm reads the transcript path reported by the agent to build progress and panel state. Transcript processing happens in the app on the Mac.

The discovery skill installed by `sp skills install` lives at `~/.agents/skills/supaterm`. Its detailed guides come from the installed Supaterm version through `sp skills get`.

## Saved state and persistent processes

Application settings and session metadata live under `~/.config/supaterm` by default. Saved session state can include layout, working directories, tab state, and coding-agent panel state.

When zmx persistence is enabled, shell and agent processes may continue after the app exits. Close the pane, tab, or window when you intend to terminate its processes.

## Clipboard and notifications

Supaterm asks before pasting unsafe multiline text and before allowing a terminal application to write to the clipboard through OSC52.

Terminal and agent notification text can be delivered through macOS. Configure lock-screen visibility in macOS System Settings and avoid placing secrets in notification text.

## Analytics and crash reports

Release builds expose separate controls under **Settings > About**:

- **Share analytics with Supaterm** sends named product and lifecycle events and identifies the installation with the Mac hardware UUID.
- **Share crash reports with Supaterm** enables automatic exception reporting and diagnostic action breadcrumbs.

Both controls are enabled by default and can be disabled independently. Automatic screen-view capture is disabled. Debug builds do not send either stream.

The same controls are available from the CLI:

```bash
sp config set privacy.analytics_enabled false
sp config set privacy.crash_reports_enabled false
```
