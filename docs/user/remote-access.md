# Remote access

Connect a phone, browser, or another desktop app to Supaterm running on a different
machine. That machine must stay running and reachable while you work.

## Pair through the Encrypted Relay

Connect across networks without opening a port on the host. On the machine
running your agents, open **Settings → Connections** and create a pairing link.
**Encrypted Relay** is enabled by default. If you turned it off, enable it first.
The relay connects when you create the first link;
the app waits until it is ready before making the link available. Paste that link into
**Add environment** on another desktop or mobile client, or scan it with the
mobile app. The host can keep **Network access** off. Clients show a relay
connection by a three-word name, such as `amber-falcon-river`, and the host's
Connections settings show the same name once it connects.

On a host you reach only over SSH, print a relay pairing link there:

```bash
supaterm pair
```

The command activates the relay before printing the link. Pass `--no-relay` to
pair directly, or `--tailscale` to pair through Tailscale Serve.

If Encrypted Relay is off, enable it from the terminal before creating the link:

```bash
supaterm settings set publicRelayEnabled true
```

Use `supaterm settings set publicRelayUrl <relay-url>` when the host should use a
different `ws://` or `wss://` relay service. Run `supaterm settings list` to see
the supported settings and accepted values, or `supaterm settings get publicRelayEnabled` to
check the effective value. Pass `--base-dir <path>` when the server uses a
custom Supaterm home. When no home is configured, a linked worktree uses its
own `.supaterm` directory.

For browser access, install the [Supaterm command line](./install.md) on the
computer running the browser, then start its companion:

```bash
supaterm relay-client
```

Open the local URL it prints and paste your relay pairing link. Keep the
companion running while you work. It serves the browser client without starting
agents or an environment on that computer. Browser previews, media, downloads,
and WebSockets use the same encrypted tunnel. A relay address must be paired
inside the app; opening it as a website does not load Supaterm.

The host and client encrypt the connection end to end. The relay forwards
encrypted bytes, including HTTP requests. Pairing permissions and authorized
client revocation work as they do for direct connections. Turning off **Encrypted Relay**
closes relay connections; turning it back on lets already authorized
clients reconnect. The host must stay running and have internet access.
After the first activation, the host reconnects automatically when Supaterm starts
while **Encrypted Relay** is enabled.

New pairing links carry the configured relay server to the clients that pair
with them. Automatically learned relay routes follow a server change through a
working connection; routes paired explicitly through relay need a new link. If Connections reports that
another host is using the relay identity, the same Supaterm data is running on a
second machine. Turn **Encrypted Relay** off and on to bring the relay back to this
host.

## Add a connection from a terminal

With the desktop app running on your receiving Mac or Linux machine, run:

```bash
supaterm app connection add "<pairing-link>"
```

Replace `<pairing-link>` with the full URL created in **Settings → Connections** or by `supaterm pair` on the host.
The command pairs and saves the connection in your local desktop app. Run it
on the receiving machine, outside an SSH session. Manage or remove the saved
connection in **Settings → Connections**.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Connections**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet
address:

```bash
supaterm serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
supaterm pair --no-relay
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Connections**
on web and desktop and **Settings → Environments** on mobile. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

Pairing links include alternative host addresses when available. The in-app
scanner and **Add environment** can use a reachable alternative when the main
address is unavailable, including when pairing a new device away from the LAN.
Older links can use another saved route when the main address belongs to one
saved machine. Each alternative must identify the intended environment before
receiving the token. A phone camera opening an unreachable LAN URL in a browser
cannot load the app to try those alternatives; use the in-app scanner or paste
the link instead.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Connections page stays open. If you leave or reload that page, create
another link to share.

### Reach one machine several ways

A saved machine can keep several routes, including LAN, Tailscale, a public URL,
and SSH. Pair it again using another address, or choose **Add route** from its
route list. Both addresses belong to the same machine in your client.

Supaterm also learns the LAN and Tailscale addresses reported by a paired
machine. Desktop, mobile, and browser clients using the local companion also
learn its relay address once relay is activated, without rescanning. On a fresh
host, create the first relay pairing link to activate it;
clients already connected directly do not need to scan that link.
Enable **Network access** on the host to make its LAN address available.
Learned routes use the existing pairing and disappear when the host withdraws
them or you remove the pairing they came from.

Your client needs a working connection to receive new addresses. If its only
route is relay and the host moves to another relay server, pair again or connect
through another saved route to learn the change.

Routes are tried in your saved preference order. Relay is last by default;
moving it higher makes it take priority over the routes below it.
Supaterm checks every route at once, including relay, and prefers the
highest-priority route that answers.
Supaterm checks for a preferred route when your network changes, when you return
to the app, and periodically while using a fallback.
A browser opened over HTTPS needs HTTPS routes; it cannot connect to plain HTTP
LAN addresses.

On web and desktop, open the machine's routes in **Settings → Connections** to
reorder or remove them. On mobile, open the machine under
**Settings → Environments** and choose **Edit**. Learned routes can be reordered,
but removing their saved pairing also removes the addresses learned through it.

Tailscale shares its `100.64.0.0/10` address range with other VPNs. An address
in that range shows as VPN unless the machine confirms it belongs to Tailscale.

Open **Permissions** next to **Routes** in web or desktop, or **Your permissions**
in the mobile route details, to see what your current connection can do on that
environment. For a remote environment, this is in its route details. Permissions
shown there apply only to the route marked **In use**; other routes are not
checked. Direct pairing and Supaterm Connect have separate sessions and may grant
different permissions.

### Balance new threads across machines

Auto balance is off by default. On web and desktop, enable it in
**Settings → Connections → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments. The section
appears once two or more machines are switched on.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. Auto balance selects an eligible
machine even when all are busy and prefers machines with spare capacity. If no usable
resource readings are available, machine preferences determine the selection. A machine
set to **Manual only** remains excluded. Mobile keeps its manual environment selection.

### Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Connections**. **Network access** can stay off; Tailscale
reaches the backend on this machine. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
supaterm serve --tailscale-serve
```

For an already-running server:

```bash
supaterm pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

```bash
tailscale serve --https=443 off
```

If that port is already in use, choose another with
`--tailscale-serve-port`. See `supaterm pair --help` for other pairing options.

### Hosted web app

A web app served over HTTPS needs an HTTPS endpoint for direct connections. It connects directly
to your server; a hosted pairing link does not make an unreachable backend
reachable or convert HTTP to HTTPS.

For an Encrypted Relay connection in a browser, use the [local companion](#pair-through-the-encrypted-relay).

For a plain HTTP LAN endpoint, use the direct pairing URL in a browser that can
open it, or pair from the desktop app. On mobile, an IP address entered without a
scheme uses HTTP, so include `https://` when your server uses HTTPS.

## Desktop-managed SSH

In the desktop app, open **Settings → Connections → Add environment**, choose
**SSH**, and enter a host or SSH alias such as `user@example.com`. Supaterm starts
or reuses a server there and opens the port forward for you. Projects, provider
credentials, and agent work stay on the remote machine.

The remote host must be Linux or an Apple Silicon Mac with `curl` or `wget`,
`tar`, `sha256sum` or `shasum`, and [provider setup](./install.md#providers).
The first launch downloads Supaterm's server to `~/.supaterm/runtime` on the host, so
it takes longer than later ones.
Provider CLIs must be on the `PATH` of a non-interactive login shell there;
check with:

```bash
ssh user@example.com 'sh -lc "command -v claude codex"'
```

If SSH reconnecting fails after an app update, retry the launch once. Removing
the connection stops a server that Supaterm launched; a server that was already
running is left alone.

Each desktop app keeps one session on the host for its SSH connection and reuses
it when it reconnects. Revoke sessions you no longer use in **Settings →
Connections** on the host, or on a headless host with `supaterm auth session list` and
`supaterm auth session revoke <id>`. A desktop that can still sign in over SSH pairs
again on its next connect.

For Antigravity's Google callback on a remote host, see
[remote sign-in](./providers-antigravity.md#sign-in-from-a-remote-device).

## Browser on a remote environment

Browser tabs belong to the environment, so you and your agents see the same
tabs from any device. The desktop app shows its own environment's tabs
directly. Every other device, and the desktop app for other environments,
streams them from the host. Agents keep using them while no device is
connected, and `localhost` addresses reach servers on the host.

The first tab downloads a headless Chrome, about 120 MB, into the Supaterm home. It
is the same browser [HTML renders](html-renders.md) use, so a host downloads it
only once. Some Linux hosts need [setup](#browser-host-setup) before it can
start.

Agent tabs have separate storage and share a Chromium process. Take control before
typing into an agent's tab, then release control when you want the agent to
continue. Read-only connections can watch without changing the page.

While you have control, the tab works with your device: text the page copies or
cuts goes to your clipboard, a file picker on the page opens your device's
picker, and a finished download is offered for you to save. Popups such as
sign-in windows open as their own tabs. Downloads stay on the host until the
tab closes. Audio does not play on your device.

On a phone, tap the floating preview's corner dot to show its controls, then
**Pop into separate window** to keep watching in picture-in-picture over other
apps.

### Browser host setup

macOS, Windows, and Linux desktops run the browser as is. Some Linux hosts need
one-time setup: Ubuntu 23.10 and later block the sandbox the browser runs in,
and minimal images and containers lack libraries it loads. When that happens,
the server says so at startup, and browser tabs and HTML previews show the
command to run on the host:

```sh
sudo supaterm browser setup
```

The server shows the exact line for how you started it, such as
`sudo npx supaterm browser setup`, and keeps your `PATH` when Node is installed only
for your user. Where `supaterm` is not on your `PATH`, such as with only the
desktop app installed, it names the full path of the app's own `supaterm` instead. It allows Chrome's sandbox with an AppArmor profile and installs
any missing libraries and system fonts with apt; pages that load without text
can mean the host has no fonts. It is safe to run again. Without `sudo`, it only
reports what it would change.

The browser always runs in Chrome's sandbox. Where you cannot change the host,
set `SUPATERM_SERVER_BROWSER_SANDBOX=0` for the environment to run without it.

## Connect an outside agent

Claude Code, Codex, ChatGPT and other agents Supaterm did not start can drive
threads on an environment through its MCP server. See
[outside agents](./outside-agents.md) for setup.

## Push notifications on iPhone

The iOS app can alert you when an agent needs approval or input, finishes, fails,
or hits a usage limit, even while the app is closed. Open **Settings →
Notifications** in the app, choose what the lock screen shows, and turn on
**Notify me**. Every saved environment is set up the next time it connects, and
**Send test** checks the whole path.

**Hidden** shows only what happened, **Titles** adds the thread and project names,
and **Full** adds the command, question, or last message. **Hide content on this
device** overrides the choice for this phone. You will not get an alert for a
thread you are actively using on another device.

Alerts are encrypted on your machine to a key that never leaves your phone. Apple
and the Supaterm push gateway see when a notification was sent to your device, but
not thread names, questions, or messages. The gateway knows your device's push
token and which machines may notify it.

On the machine, push is on by default under **Settings → General → Push
notifications**, which also lists registered devices. To stop alerts from one
machine, turn notifications off in the app, remove the environment, remove the
device there, or revoke the phone's session in **Settings → Connections**. A
device removed there stays off for that machine until you tap **Turn on again**
next to it in the app's notification settings. If an
environment reports that it does not allow a notification service, add that
service's address to the machine's push gateways in the same section.

## Manage or revoke access

On the host, **Settings → Connections** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `supaterm auth --help`.

To restore a device whose session was revoked, pair it again with a fresh link.
If the link's address is one the device already uses for that machine but cannot
reach right now, such as a LAN address while on cellular, it pairs through the
machine's other saved routes instead.

A session with an open connection stays listed after its access credential
expires.

To choose a token's permissions, pass `--scope` once for each scope you want:

```sh
npx supaterm pair --scope orchestration:read --scope terminal:read
```

The selected scopes replace the default permissions. The same option works with
`npx supaterm auth pairing create` and `npx supaterm auth session issue`; each command's
`--help` lists the available scopes. Without `--scope`, pairing tokens and issued
bearer sessions get every permission, including managing access. A terminal or a
full-access agent on the host can reach that as well, so a client that should
not manage access also needs to go without `terminal:operate` and
`orchestration:operate`.

To change an existing client's permissions, create a fresh pairing link with the
scopes it needs. In a browser opened directly on the environment, open that link
to replace the browser's current grant. For mobile or a saved remote environment
in web or desktop, use **Add Environment** with the fresh link or code; pairing
the same environment replaces its saved grant. Reconnecting alone does not change
permissions.

Grouping checkouts does not combine their permissions. Shared project settings
require `orchestration:operate` on every member environment; actions on one
checkout use that checkout's permissions.

`source-control:write` covers direct Git and pull request changes made from the
client: pushing, switching or creating branches, cloning, and removing
worktrees. It does not restrict what a task does. Starting a task in a new
worktree still creates that branch and worktree with `orchestration:operate`,
and the agent it runs can use Git however the environment allows.

Settings changes, provider management, environment maintenance, and access
management can each be granted separately. New pairings without `--scope`
include all of them. Existing clients keep the
permissions they paired with and can stay connected after an update, but newly
separated features may require pairing again with the permissions they need.
Older clients may show controls that the server denies. Create a fresh pairing
link to change a client's permissions.

`filesystem:read` allows browsing host files, opening workspace files, and viewing
local changes. Add `filesystem:write` to allow editing files or saving plans to
the workspace. These scopes control direct file access from the client.

Treat pairing URLs and pairing codes as passwords. Do not include them in
screenshots, logs, or bug reports.

## Using the Desktop App as a Remote Only

If a computer should only drive work running elsewhere, turn off its local environment. In the
desktop app, open **Settings → Connections** and switch off **Local
environment**. Supaterm restarts without a local server: no local agents or terminals run, WSL
backends stay off, and other devices can no longer connect to this computer. Your projects,
history, and saved connections are kept, and you keep working through paired environments or SSH.

Switch **Local environment** back on in the same place to restart with your previous local
settings.
