# Remote architecture

Each connection joins a client to one environment over HTTP and WebSocket. The
environment owns providers, execution, files, and durable state. Direct access,
Tailscale, and SSH change how the client reaches that server; they do not
introduce another execution model. See
[remote access](../user/remote-access.md) for setup.

## Identity is independent of the route

An environment keeps its ID across server restarts and endpoint changes. Saved
connections are local to a client profile; the server's identity and state are
not. A repository identity can correlate clones across environments, but never
routes work between them. A project and its threads belong to one environment.
The canonical key follows the remote `gh repo set-default` marked as the base,
else the `upstream` remote when one exists, so pull request features target the
repository `gh` opens pull requests against. A fork also reports its own
`origin`, and clients group and label by that, so a fork never collapses into a
checkout of its upstream.

[Environment ID initialization](../../apps/server/src/environment/ServerEnvironment.ts)
must publish a complete ID atomically. Repair of an empty ID file retains a
recovery file so concurrent or delayed initializers choose the same winner.
Removing that recovery state as ordinary temporary-file cleanup can change the
identity underneath an already-running server.

Advertised endpoints are reachability hints. Only the connecting device can
prove that a route works. In particular, a host's loopback address refers to a
different machine when another device opens it. Endpoint selection must not
silently fall back to loopback when a shareable endpoint is unavailable.

Saved routes share one environment identity but may have separate credentials.
The [driver](../../packages/client-runtime/src/connection/driver.ts) verifies a
direct address against the public environment descriptor before sending its
credential. A saved LAN address may belong to a different machine after a network
change. The [supervisor](../../packages/client-runtime/src/connection/supervisor.ts)
authorizes a preferred route before replacing a working session and applies a
cooldown after a failed switch.

Learned routes reuse their saved pairing's bearer credential. Removing that
pairing removes its learned routes; an updated advertisement removes addresses
the server no longer reports. User-saved routes survive advertisement changes.
A paired token only goes to a plain HTTP address off the tailnet when it was
itself paired over plain HTTP or over the relay, so a token paired over HTTPS or
the tailnet never starts travelling unencrypted. Relay pairings are exempt
because a relay-paired phone holds no other credential for its LAN fast path.

[GitHub routing trust](../../packages/client-runtime/src/connection/githubRoutingPermissions.ts)
covers every user-saved route. Adding or changing an address revokes the grant;
reordering and learned-address changes preserve it.

## Hosted web is a client

The hosted web app stores its connection catalog in the browser and connects
directly to each environment. It does not proxy traffic or hold server-side
pairing state. Hosting the UI over HTTPS therefore cannot make a plain HTTP LAN
backend accessible from that browser context.

A [hosted pairing URL](../../apps/web/src/hostedPairing.ts) identifies the backend
in its query and carries the pairing secret in its fragment. Fragments stay out
of requests to the hosted origin. The browser exchanges the secret with the
environment and strips it from its history. Moving the token into a query
parameter would disclose it to the wrong origin.

## Access and process ownership are different

Tailscale supplies an endpoint for ordinary pairing, so it needs no separate
environment type. Authentication remains the environment's responsibility for
every route. See [environment authentication](./environment-auth.md).

SSH can launch a server as well as forward a port. Desktop main owns that
lifecycle because it can spawn SSH and handle authentication prompts. The
renderer uses the forwarded endpoint through the shared connection runtime.
[SSH cleanup](../../packages/ssh/src/tunnel.ts) stops a remote server only if the
launcher owns it; a server it discovered already running must survive a client
disconnect. Reconnection restores the forward before opening the application
transport.

Remote servers can outlive several client releases. Clients must use advertised
capabilities and handle their absence, rather than assume their own version
describes the server. Process replacement belongs to the launcher's
[update protocol](./server-updates.md); the connection runtime handles the
resulting disconnect.

### Desktop without a local environment

Desktop normally launches its own primary server, but the desktop setting `localEnvironmentEnabled`
(`apps/desktop/src/settings/DesktopAppSettings.ts`) turns that off. Changing it relaunches the app;
no local state is deleted. On the next start the main process skips port selection, server exposure,
and the primary and WSL backends, and opens the window right away. The renderer sees this through
`desktopBridge.getLocalEnvironmentEnabled()`: `readPrimaryEnvironmentTarget` returns null, so primary
auth and platform-managed discovery are skipped and only saved environments (pairing, SSH) connect.
This is possible because the desktop renderer is not served by the backend: the `supaterm://` scheme
serves the bundled client from disk (Vite in development) and API traffic always goes to the
environment's own URL.

## Push notifications

Push reaches an iPhone through Apple, so the design keeps Apple and the push
gateway blind. The host seals each notification with HPKE to the phone's
per-environment X25519 key and signs it with a dedicated `push-identity` key, never
`relay-identity`. The gateway (`push.supaterm.com` by default) holds APNs tokens and
host-scoped handles; the host holds only handles. Apple and the gateway see a
generic alert and an envelope padded to one of three sizes.

A registration belongs to the auth session that created it and cannot move to
another. Revoking that session, or finding it expired at startup, retires the
registration and drops its gateway handle.

The [candidate reactor](../../apps/server/src/notifications/PushCandidateReactor.ts)
reads committed events from its own cursor instead of hooking the event sink, so a
slow gateway can never delay a commit. Its cursor starts at the head on first boot,
so history never notifies. Only a consumed event raises an occurrence (a finished or
failed run, a pending request) and that event dates it. The projection may already
be pages ahead of the cursor, so it only decides whether an occurrence is the
thread's current attention, using the same shared classifier as desktop
notifications. An occurrence that is not current, such as a completion held by
background work or an approval hidden behind another, waits as a superseded delivery
until a later event brings that attention back and dates it. Archiving a thread or
pausing a question dismisses its alerts for good. Restart reconciliation never
notifies, and attention it brings back is retired rather than rearmed.

The [delivery worker](../../apps/server/src/notifications/PushDeliveryWorker.ts)
persists the sealed envelope before the first send and reuses its notification ID
on retries, so a send that reached the phone but timed out here is dropped by the
phone's replay ledger. Every registration write bumps a revision, and an envelope is
reused only under the revision it was sealed for, so a retry never sends ciphertext
for a key or preview level the phone has replaced.

Suppression uses thread activity leases and the client's last real input, never
`thread.visit`, which reports pane ownership rather than visibility. A client that
shows a thread sends one activity report when new attention lands there instead of
streaming input. The host drops a completion only when a report made after the
event shows input just before it, and holds approvals while the thread is watched.
When the signals disagree the result is a duplicate alert, never a lost one.

The host contacts only origins in `pushGatewayOrigins`: HTTPS, or HTTP on
localhost for development. It rejects origins that resolve to private or
link-local addresses and follows no redirects. The address check is not pinned to
the connection; that is acceptable because only the host owner edits the list.
