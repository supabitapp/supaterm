---
title: Remote hosts
description: Run persistent tabs and panes on a machine reached through SSH.
---

Supaterm can run a tab or pane on a configured SSH host while keeping the window, tab, and split layout on your Mac.

## Add a host

Open **Settings > Hosts**, then enter a short name and an SSH destination. Supaterm uses the system `ssh` command, so keys, agents, host aliases, jump hosts, and known-host checks work as they do in Terminal.

The host ID comes from the name. Use that ID with `sp`:

```bash
sp tab new --host build --cwd /srv/project --focus
sp pane split --host build --cwd /srv/project right -- make test
```

Paths and commands belong to the remote machine. A tab without a command starts the remote account shell. `--script` runs through `/bin/sh` on the remote machine.

## First connection

Supaterm checks the remote operating system and CPU, selects its bundled session host, and uploads it to the remote account under `~/.local/share/supaterm/hosts`. The content hash sets the install path, so each build uploads once.

Supaterm supports Linux and macOS hosts on Intel and ARM. The remote account needs a POSIX shell and write access to its home directory. No admin access or separate install is needed.

## Persistence and close behavior

The remote process runs inside Supaterm's session host. It can survive an SSH disconnect, an app restart, or a network change. Supaterm checks the remote host and reconnects to the same session. If the host cannot be reached, it keeps the pane and tries again.

Closing a remote pane, tab, group, or window asks that host to stop the matching sessions. Quitting Supaterm keeps them alive when session persistence is enabled.

Supaterm never turns a missing remote host into a local shell. If its host entry was removed, the restored pane shows a configuration error.
