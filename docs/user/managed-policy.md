# Managed policy

A managed policy lets an administrator set defaults, lock settings, and restrict what Supaterm can
do for everyone on a machine: the broadest permission mode, which clients may connect, the
Encrypted Relay, the preview tunnel, which providers run, and how Supaterm updates. The Supaterm
server on that machine enforces the policy for every client that connects to it, whether desktop,
web, or mobile. Clients show "Managed by <organization>" on the controls it locks.

## Roll out a policy

1. Write the policy as JSON (see [Write a policy](#write-a-policy)). Every local user can read it,
   so leave secrets out.
2. Check it on a machine with the same Supaterm version: `supaterm policy check policy.json`.
3. Deploy it to [one supported location](#where-the-policy-goes) with your device management tool
   or as a file.
4. Restart Supaterm on the machine. The server reads the policy only when it starts.
5. Confirm it loaded with `supaterm policy show`.

## Write a policy

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "supportUrl": "https://it.example.com/supaterm",
  "settings": {
    "defaultRuntimeMode": { "value": "approval-required", "locked": false },
    "enableAgentBrowserAccess": { "value": false, "locked": true }
  },
  "limits": {
    "maxRuntimeMode": "auto-accept-edits",
    "clients": ["desktop", "local-browser"]
  }
}
```

`schemaVersion` and `organization` are required. Clients name the organization on every locked
control, and `supportUrl` adds a link to your help page. Supaterm refuses a policy with a key it
does not know, because that key might be a restriction this version cannot enforce.

## Where the policy goes

Use one source per machine. When a native policy and a policy file both exist, Supaterm does not
start.

| OS      | Native policy                                                                                         | Policy file                                         |
| ------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| macOS   | Configuration profile for the `com.supaterm.desktop` domain                                           | `/Library/Application Support/Supaterm/policy.json` |
| Windows | Group Policy template, or a `Policy` value (`REG_SZ`) under `HKLM\SOFTWARE\Policies\Supabit\Supaterm` | `C:\Program Files\Supaterm\policy.json`             |
| Linux   | None                                                                                                  | `/etc/supaterm/policy.json`                         |

Make the policy file writable only by administrators.

- **macOS profile**: `supaterm policy templates <dir> --policy policy.json` writes
  `macos/supaterm.mobileconfig` from your policy. You can also convert it yourself with
  `plutil -convert xml1 -o com.supaterm.desktop.plist policy.json`. Deploy it as one device profile.
  A profile cannot hold `null`, so use a policy file for a policy that needs one.
- **Windows Group Policy**: `supaterm policy templates <dir>` writes `windows/supaterm.admx` and
  `windows/en-US/supaterm.adml`. Import them into `PolicyDefinitions` or Intune, then configure
  **Computer Configuration → Administrative Templates → Supaterm**. **Organization** is required.
  Run `gpupdate /target:computer /force` and restart Supaterm.
- **Windows registry**: set `Policy` (`REG_SZ`) to the whole policy as single-line JSON. Do not
  combine it with values from the Group Policy template.
- **WSL**: a server inside WSL reads `/etc/supaterm/policy.json` in its distro, not the Windows
  policy, so the desktop app on a Windows machine with a policy does not run its WSL backend. A
  server you start yourself inside WSL needs the policy file in that distro.

## Check what the server loaded

Run `supaterm policy show` as the user who runs Supaterm. It prints the installed policy, its
fingerprint, and whether the running server loaded that version. After you change or remove a
policy, restart the desktop app, run `supaterm service restart` for a background service, or stop
and start a server you run with `supaterm serve`. Removing a policy brings back each user's own
saved settings.

The server does not start when the policy is unreadable, invalid, uses keys from a newer Supaterm
version, or conflicts with another policy source. The desktop app then says the policy stopped it
and shows the server's error for users to send you. Check every policy with
`supaterm policy check`, and update Supaterm before you deploy keys a newer version added.

## Settings

`supaterm policy settings` lists every setting a policy can manage, by its path in
`settings.json`, with its default. Each entry under `settings` takes a `value` and `locked`:

- `"locked": false` replaces the built-in default. Users can still change it.
- `"locked": true` also stops users and agents from changing it, in Settings, in project settings,
  and from the command line.

`supaterm settings set` on a locked setting succeeds without changing anything when you pass the
locked value. Any other value fails with a message that names your organization. A boot script
that sets the same values the policy locks keeps working.

A lock on a top-level setting also applies inside every project's settings. A few settings need
more than one entry:

- Lock `worktreeCleanup` together with the worktree rules in `storageCleanup`, because
  `worktreeCleanup` overrides them.
- Lock `providerInstances.<id>` as a whole, or pin fields for every instance of a driver with
  [`limits.providers.instances`](#providers).
- Manage a setting that can be empty as a whole, rather than one field inside it.
- `defaultRuntimeMode` cannot be broader than `limits.maxRuntimeMode`.
- `observability` cannot be managed, because each user's environment and settings file decide the
  OpenTelemetry endpoints before the policy loads.

## Limits

Limits are restrictions that are not settings, so users cannot change them anywhere. Each limit is
optional. A missing limit restricts nothing.

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "limits": {
    "maxRuntimeMode": "auto-accept-edits",
    "clients": ["desktop", "local-browser", "remote"],
    "relay": false,
    "previewTunnel": false,
    "providers": {
      "allowedDrivers": ["claudeAgent", "codex"],
      "instances": {
        "claudeAgent": {
          "locked": true,
          "environment": [{ "name": "CLAUDE_CODE_USE_BEDROCK", "value": "1" }]
        }
      }
    },
    "updates": { "mode": "auto", "allowNightly": false }
  }
}
```

### Permission modes

`maxRuntimeMode` is the broadest [permission mode](./permission-modes.md) any thread may use:
`approval-required` (Supervised), `auto-accept-edits`, `auto`, or `full-access`. Clients disable
the broader modes and say who manages them. A thread already in a broader mode cannot run turns
until someone switches it to an allowed mode, and the mobile app offers that switch on the thread.
A side chat opened from such a thread starts in `maxRuntimeMode`.
Scheduled tasks and agents that start threads through Supaterm's tools stay within the same cap.

While `maxRuntimeMode` is set, the policy owns every provider's launch settings: the binary path,
launch arguments, home and command paths, server URL, and environment variables. Users cannot
change them. Pin the values your providers need under [`providers.instances`](#providers), with an
absolute `binaryPath` so a program earlier on a user's `PATH` cannot stand in for the provider CLI.
Leave `acpRegistry` out of `allowedDrivers` if users should not add ACP Registry agents.

### Clients and the Encrypted Relay

`clients` lists the clients the server accepts: any of `desktop`, `local-browser`, and `remote`.

- `desktop` is the desktop app on the same machine. Keep it on machines where people use the
  desktop app.
- `local-browser` is a browser on the same machine, which includes a server started with
  `supaterm serve` that listens only on loopback.
- `remote` is everything off the machine: phones, other computers, and remote browsers, over the
  [Encrypted Relay](./remote-access.md#pair-through-the-encrypted-relay), the network, or
  [Tailscale](./remote-access.md#tailscale-https).

A headless server that listens on loopback and is reached through the relay needs
`["local-browser", "remote"]`. A server that listens on a network address needs `remote`, and so
do the desktop app's **Network access** and Tailscale HTTPS. Without `remote`, the desktop app
keeps its server on this machine with both off, and brings back each user's choice once the policy
allows it.

Without `remote`, the server refuses relay pairing, turns the relay off, and no device off the
machine can pair. The server does not start on a network address or with `--tailscale-serve`. At
startup it turns off Tailscale Serve routes that forward to it, and it does not start while one
remains.

`"relay": false` turns the Encrypted Relay off whatever **Encrypted Relay** is set to, and refuses
relay pairing. Network and Tailscale connections keep working when `clients` includes `remote`.
Devices that paired through the relay stay authorized, but cannot reach the server through it.

To keep everyone on your own relay service instead, lock its address in `settings`:

```json
"settings": {
  "publicRelayUrl": { "value": "wss://relay.example.com", "locked": true },
  "publicRelayEnabled": { "value": true, "locked": true }
}
```

Lock `publicRelayEnabled` too if users should not turn the relay off. New pairing links carry the
locked relay address to the devices that pair with them.

### Preview tunnel

`"previewTunnel": false` stops other devices from loading this machine's `localhost` pages through
the preview tunnel, whatever the
[Preview tunnel setting](./remote-access.md#browser-on-a-remote-environment) says. Port
forwarding and **Open on this device** are unavailable. Browser tabs keep working by streaming from
the machine.

### Providers

- `providers.allowedDrivers` lists the providers that may run: `codex`, `claudeAgent`, `cursor`,
  `grok`, `opencode`, `antigravity`, `fx`, `kiro`, `pi`, `muse`, and `acpRegistry`. Clients leave
  the others out of the model picker, and a thread already on one shows its model as unavailable.
- `providers.instances` sets fields on every instance of a driver: `binaryPath`, `launchArgs`, and
  `environment` variables, such as the ones that route a provider through your cloud account or
  gateway. `"locked": false` fills only what a user left empty. `"locked": true` holds the values
  and stops users from changing them.

A locked `codex` entry runs Codex from an existing Codex CLI login, so **Connect with ChatGPT** is
unavailable. A locked `opencode` entry has Supaterm start OpenCode itself, so **Server URL** stays
empty.

### Updates

`updates` covers updates of Supaterm itself, in the desktop app and on the server:

- `mode`: `auto` keeps the normal flow, where Supaterm checks for updates and installs one only
  when someone asks. `off` stops checks and installs, for machines that get Supaterm from a
  container image or device management.
- `feedUrl`: the desktop app, `supaterm update`, and server updates started from another device
  install from your mirror instead of GitHub. Lay it out like a GitHub release: the update file for
  each platform you run (`latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`,
  `latest.yml` for Windows) and the desktop installers they name at the URL's root, and the
  `supaterm-*` archives and `SHA256SUMS` under `v<version>/`. Nightly builds update only from the
  `nightly` versions of those update files. Publish only the versions you have approved.
- `allowNightly: false` makes the nightly channel unavailable. A desktop app already on the
  nightly channel stops updating until its user switches the update track to Stable.

When the desktop app cannot use the policy, its own updates stay off until an administrator fixes
the policy.

Provider CLI updates follow the `enableProviderUpdateChecks` setting, not `updates`. Lock it to
`false` to stop them. Supaterm then also stops downloading model catalog updates, so new models
may not appear until you update Supaterm.

## Example: a headless Linux server behind your own relay

This policy fits a server that runs headless on Linux, listens on loopback, and is reached only
through your organization's relay service:

```json
{
  "schemaVersion": 1,
  "organization": "Example Corp",
  "supportUrl": "https://it.example.com/supaterm",
  "settings": {
    "publicRelayEnabled": { "value": true, "locked": true },
    "publicRelayUrl": { "value": "wss://relay.example.com", "locked": true },
    "enableProviderUpdateChecks": { "value": false, "locked": true },
    "defaultRuntimeMode": { "value": "auto-accept-edits", "locked": false }
  },
  "limits": {
    "clients": ["local-browser", "remote"],
    "providers": { "allowedDrivers": ["claudeAgent", "codex", "opencode"] },
    "updates": { "mode": "off" }
  }
}
```

1. Install it as `/etc/supaterm/policy.json`, owned by root and readable by everyone.
2. Run `supaterm policy check /etc/supaterm/policy.json` where you build the machine or image.
3. Start the server as usual, then confirm with `supaterm policy show` as the user who runs it.
4. Run `supaterm pair` to print a relay pairing link that uses `relay.example.com`.

The `settings` block replaces `supaterm settings set` calls in a boot script. Calls that set the
same values can stay: they succeed without changing anything.

## What a policy does not cover

- **The desktop app's own controls.** Importing cookies from other browsers is not managed yet.
- **Provider CLIs.** Agents run through each provider's own CLI, which reads its own configuration,
  such as `~/.claude`, and which a user can also run outside Supaterm. Restrict those CLIs with their
  own managed configuration, such as Claude Code's managed settings.
- **Local administrators and other tools.** A user with administrator rights can edit or remove the
  policy, or replace Supaterm. Without `remote`, Supaterm does not expose the server, but a user can
  still forward its local port with other tools. Use your device management tool to control which
  builds run and what the network allows.
