---
title: Troubleshooting
description: Diagnose connection, targeting, configuration, agent, notification, and persistence problems.
---

Start with Supaterm's live diagnostic report:

```bash
sp diagnostic
```

Add `--json` when attaching structured output to a bug report.

## `sp` cannot reach Supaterm

List reachable app instances:

```bash
sp instance ls
```

Inside a Supaterm pane, `SUPATERM_SOCKET_PATH` normally selects the owning app. Outside Supaterm, one reachable instance is selected automatically. If more than one is running, select one explicitly:

```bash
sp diagnostic --instance work-mac
sp ls --instance work-mac
```

Use the endpoint ID from `sp instance ls --json` when names are duplicated.

## A command targets the wrong terminal

Inspect the live hierarchy:

```bash
sp ls --json
```

Pass the resulting UUID, or a 1-based selector such as `1/2/3`, rather than relying on ambient pane context. See [targeting](/guides/cli/targeting).

## Terminal configuration is invalid

Validate Supaterm settings:

```bash
sp config validate
```

The terminal settings page shows the active Ghostty config path. When Ghostty reports invalid configuration, Supaterm opens a recovery view with **Reload Configuration** and **Ignore** actions. Fix the reported lines, then reload.

## Coding-agent status does not appear

1. Confirm the agent is running inside a Supaterm pane.
2. Open **Settings > Coding Agents** and read the integration message.
3. Confirm the executable is available from your login shell. Codex must be 0.144.1 or newer.
4. Toggle the integration off and on to reinstall Supaterm-managed configuration.
5. Run `sp diagnostic` in the agent pane.
6. Verify bundled guides with `sp skills list` and reinstall the discovery skill with `sp skills install` if needed.

Supaterm repairs incomplete or changed managed integrations when the app starts. It does not replace unrelated agent settings.

## Notifications do not appear

Enable **Settings > Notifications > System notifications**, then verify permission under **macOS System Settings > Notifications > Supaterm**.

Unread badges can still appear when macOS delivery is disabled. The glowing pane ring has its own independent toggle.

## Sessions do not survive a relaunch

Enable both **Restore Terminal Layout** and **Persist Sessions Using zmx** under **Settings > General**. Restart Supaterm after changing zmx persistence.

Closing a pane, tab, or window terminates its sessions by design. Persistence covers app relaunch, not intentional terminal closure.

## Collect local logs

Enable **Settings > Advanced > Enable Verbose Logging** and reproduce the issue. Supaterm emits debug diagnostics to local OSLog under subsystem:

```text
app.supabit.supaterm
```

Disable verbose logging after collecting the relevant output.
