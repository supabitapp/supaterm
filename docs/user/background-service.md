# Running Supaterm in the background

On Linux and macOS, Supaterm can run as a service for your user so you do not need
to keep a terminal open.

## Manage the service

Install the `supaterm` CLI first ([Install Supaterm](./install.md#command-line)), then
run these commands on the machine that will host Supaterm:

| Task                            | Command                      |
| ------------------------------- | ---------------------------- |
| Install and start               | `supaterm service install`   |
| Inspect status and log location | `supaterm service status`    |
| Move to a newer release         | `supaterm update`            |
| Restart                         | `supaterm service restart`   |
| Stop and remove from startup    | `supaterm service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `supaterm service install` again repairs a service that `supaterm service status`
reports as broken.

`supaterm update` downloads the newest release on your channel and switches `supaterm`
and the service to it. Restarting interrupts running agent turns, terminals,
and remote clients, so it asks first; answer no and the service keeps running
the old version until you run `supaterm service restart`. Pass `--yes` from a
script. A server you started by hand is left running; stop and start it again
to pick up the new version. Wait for any remote update already in progress
before updating; to match a remote client's version, follow
[Updating Supaterm](./updating.md).

Pass an exact version (`supaterm update 0.0.42`) to pin one, `--channel nightly` to
switch trains, or `--allow-downgrade` to move backwards. `preview` is a
maintainers' test train: its builds can be broken and are never offered as
updates, so the installer and `supaterm update` ask for confirmation before
installing one.

`supaterm uninstall` removes the background service, the `supaterm` launcher, and the
downloaded versions after showing you the list and asking once. Your projects,
threads, and settings under `~/.supaterm/userdata` are kept, along with `service.env`
under Supaterm home. Pass `--yes` from a script.

## Configure the service environment

Put custom environment variables in `service.env` under the service's Supaterm home
directory, normally `~/.supaterm/service.env`. This file survives service installation
and updates. For example:

```dotenv
SUPATERM_PORT=3773
SUPATERM_HOST=127.0.0.1
```

Use `KEY=VALUE` entries, quoting values that contain spaces or `#`. Values are
literal: shell commands and variable expansion are not evaluated. Entries
override the inherited service environment, except for `PATH`, `SUPATERM_HOME`,
`SUPATERM_BOOT_SERVICE_UNIT`, and `SUPATERM_SERVICE_LAUNCHER_CONTEXT` (including case variants).

Run `supaterm service restart` after changing the file. Changes apply when the service
starts again; switching the server version alone keeps the current values.
For a service installed before env-file support, run `supaterm service install` once
with an up-to-date CLI.
A missing file is ignored; other read failures stop service startup.
If the file contains credentials, restrict access to that file with `chmod 600`
(for the default Supaterm home, `chmod 600 ~/.supaterm/service.env`).

## Platform support

Linux needs systemd user services. Setup enables lingering so Supaterm starts at
boot and keeps running after logout. If this needs administrator permission,
setup prints a recovery command before changing the service.
Agents and terminals run in their own systemd scopes, so when one runs the
machine out of memory only that agent is killed and its turn fails with
"Killed: out of memory." Processes they start, such as dev servers, keep
running when the service restarts.

macOS starts the service when you log in and stops it when you log out. Keep the
Mac logged in and awake for unattended remote access. Installing over SSH while
nobody is logged in at the Mac's screen can fail at the final start step; the
service is still installed and will start at the next login.

Windows background services are not supported.

## Troubleshooting

Start with `supaterm service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running Supaterm as root creates a separate installation. Without
administrator access, run `supaterm serve` in a terminal and keep that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status supaterm.service`, then use the repair command printed by Supaterm.                  |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `supaterm service restart`.                      |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `supaterm` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.supaterm.desktop.service.plist`.

## Reclaim database space

Supaterm removes superseded internal history on its own while it runs; your
conversations are kept. Databases created before this shrank automatically
still hold the freed space on disk until a one-time offline repair returns it
and turns on automatic shrinking. Settings > Maintenance (web and desktop) or
Settings > Maintenance (mobile) suggests the repair when at least 1 GiB can be
reclaimed.

Run `supaterm doctor` on the machine that hosts the environment. It reports the
database size and the space it can reclaim, then asks which repairs to run;
pass `--fix` to run the recommended ones without a prompt (for scripts), or
`--dry-run` to only report. An installed background service for the same data
directory is stopped for the repair and started again afterwards, also when
the repair fails. Quit a server you started by hand, or the desktop app, first:
the repair refuses to touch a database that is in use. Use `--base-dir` for a
different data directory.

The repair can take several minutes on a large database. It rebuilds the
database through a temporary copy, so it needs free space of about the
database's size twice over: once in the system temporary directory (`TMPDIR`
or `/tmp` on Linux and macOS) and once next to the database for its
write-ahead log.

## Access from the local network

A managed service accepts private-network connections by default, including LAN and VPN
addresses, and rejects public-network peers. An explicit host setting overrides the listener
choice. Pair each client before use; see [remote access](./remote-access.md) for encrypted
relay and Tailscale connections.
