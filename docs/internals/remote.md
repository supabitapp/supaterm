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
routes work between them. A project and its threads belong to one environment;
an agent reaches another environment's threads only through a peer link.
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
itself paired over plain HTTP, so a token paired over HTTPS or the tailnet never
starts travelling unencrypted. A tailnet label counts only on a tailnet address.

A relay-paired token only travels inside the relay's end-to-end encrypted
tunnel: through the relay server, or straight to the host over the LAN or
tailnet with the same handshake. It never takes a plain HTTP route, tailnet
included. The direct tunnel pins the host identity from pairing, never one
learned over plain HTTP, so its candidate addresses only need to be reachable.
The host advertises them as `tunnelEndpoints`, apart from `directEndpoints`,
because older clients turn every direct endpoint into a plain HTTP route.

[Pull request routing trust](../../packages/client-runtime/src/connection/pullRequestRoutingPermissions.ts)
covers every user-saved route. Adding or changing an address revokes the grant;
reordering and learned-address changes preserve it.

## Peer links

A [peer link](../../apps/server/src/peer/PeerLinks.ts) lets one environment's
agents work in another. The linking environment signs in to the other's `/mcp`
as an outside MCP client, with a pairing code from it, and keeps that session's
token in its own secret store. The other environment needs nothing new: it
sees one more OAuth client, lists it in Sharing & access, and revokes it there.
Unlinking on the linking side only forgets the token.

- **The Linked environments beta (`linkedEnvironmentsEnabled`) gates both
  sides.** Off on the linking side, `PeerLinks.link`, link requests and
  `PeerForwarding.call`/`links` refuse; `readThread`, `waitForThread`,
  `interruptThread` and `setThreadDone` do not, so a remote task already
  running still completes and can still be cancelled. Off on the receiving
  side, link registrations are refused and link sessions get a 403, which the
  linking side reports as retryable so the task's follower waits rather than
  failing it.
- **A tool runs in a linked environment when its parameters take
  `OrchestratorMcpEnvironmentTarget`** as `environmentId`.
  [`McpToolAccess.toLayer`](../../apps/server/src/mcp/McpToolAccess.ts) sends
  such a call there once the tool's access declaration has checked the caller,
  so a read-only or ended caller is refused before anything is sent. The
  thread or project the call names is checked where it lives. A tool that acts
  as the calling thread itself cannot take a linked environment.
- **Every forwarded call carries the calling agent's modes** in
  `Supaterm-Mode-Limit`, which the receiving `/mcp` only ever narrows the
  client's approved access with. A plan-mode agent therefore cannot start
  full-access work through a full-access link.
- **A descriptor's environment id filters addresses; it does not prove
  identity.** The token goes only to an address that reports the linked id, so
  a LAN address that now reports another machine's never receives it. Anything
  can report any id, though, so only addresses from the user's client count as
  a machine's, and never a loopback one, which names whichever machine opens
  it. An address an agent gives is recorded alone, and
  [`linkRequestTarget`](../../packages/client-runtime/src/linkRequest.ts) names
  a machine for it only when the client already reaches exactly one machine
  there. An address alone never moves an unexpired link to another address.
- **A relay address is reached through a tunnel the server opens itself.**
  `PeerLinks` holds a [`RelayCompanion`](../../apps/server/src/relay/RelayCompanion.ts)
  lease per relay address, with the handshake a client uses, and releases it
  when the link is forgotten. The peer's
  [`RelayIngress`](../../apps/server/src/relay/RelayIngress.ts) lets `/mcp` and
  the MCP OAuth endpoints through the tunnel for this and nothing else new.
- **All callers on one side share the link's single session on the other**,
  so idempotency keys are hashed with the caller's namespace before they
  leave. Without that, two agents reusing a key would collide on the far side.
- **A forwarded wait is split into calls of at most 45 s**, because the
  receiving `/mcp` sends nothing while a wait is open and a proxy on the route
  may drop an idle request.

**Work a link paired below full access starts stays within that link.** The
receiving environment knows a session is a peer link because the linking side
registers its OAuth client with the `supaterm-peer-link` software id, and the
marker is signed into the session. Threads that session launches carry it, with
the access it was paired with, as an immutable `linkOrigin`, and so do the
subagents, forks and `create_threads` they derive. The rules live in
[`mcp/linkOrigin.ts`](../../apps/server/src/mcp/linkOrigin.ts) and run in the
shared access declarations, not tool by tool:

- linked work may change only threads with the same origin, not the user's own
  threads and not another link's;
- it cannot change projects, settings or scheduled tasks, nor use the receiving
  environment's own links;
- its project setup scripts are skipped
  ([`ProjectSetupScriptRunner`](../../apps/server/src/project/ProjectSetupScriptRunner.ts)
  checks every path that runs them).

Reads are not fenced, and a client's own `thread.create` can never carry
`linkOrigin`.

The link is routing, not isolation: an agent the link starts runs as the
receiving environment's user. **A full-access link is therefore not fenced**:
its agents can already do anything that user can, so the fence would only stop
Supaterm's own tools. Its work still carries `linkOrigin`, so clients show where
it came from. A stamp that does not say its access is fenced.

**A delegated task can run in a linked environment.** Its child is then an
ordinary thread there, so the parent here records the task without a child
thread of its own (`remoteChild` instead of `childThreadId`). A follower in
[`RemoteDelegation`](../../apps/server/src/peer/RemoteDelegation.ts) waits on
that thread and completes the task with `delegated_task.remote.complete`. That
internal command reuses the parent half of a local finalize, so the parent
wakes the same way. Open remote tasks are followed again at startup, which is
also what keeps restart recovery from treating them as abandoned provider work.

- **The task is recorded before its launch is sent** (`remoteLaunch`), with the
  key the launch carries. A lost answer or a restart sends the same launch
  again and finds the thread it already started. A link made again has another
  session there that does not know the key, so the launch is bound to the link
  it was recorded under and refused at the credential lookup instead of
  starting a second thread. A task that ended here first asks which thread its
  launch started (`replayOnly`) instead of sending it, so cancelled work never
  starts there. A launch still on its way when that question arrives can.
- **Mark Done and Reopen on the parent are owed to the thread there**
  (`remoteChild.doneOwed`), recorded in the same transaction on the latest task
  of each thread. Sends to one thread there take turns, so they arrive in
  order. The follower retries while the peer gives no answer. It drops a Done
  that new work here undid, or that the thread there answers with a refusal,
  because that thread is in use there.

Clients list a delegated thread under its parent only when they also list the
parent ([`threadShell.ts`](../../packages/client-runtime/src/state/threadShell.ts)),
so its work is never out of reach from a client connected to one side alone.

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

## Desktop previews tunnel loopback

A desktop webview for another environment keeps `localhost` URLs and reaches the environment's
loopback through `/api/preview/tunnel`, one WebSocket per TCP connection, on the same origin as
every other request. That is why it works over any connection method. Four choices are easy to
undo by accident:

- **Fixed proxy, not PAC.** Chromium never consults a PAC script for loopback hosts, even with
  `<-loopback>`. The partition uses a fixed SOCKS5 proxy with the bypass list
  `*,<-loopback>,169.254.0.0/16,fe80::/10`, in that order, since the last matching rule wins:
  everything is direct except loopback. `<-loopback>` also takes link-local addresses, so the last
  two rules hand them back to the direct route. A fixed proxy also has no
  direct retry, so a failed tunnel is a connection error and never the reviewer's own localhost.
  The rule matches hostnames, not resolved addresses, so a custom name that resolves to loopback
  still goes direct.
- **Media tickets.** Desktop main opens the tunnel but holds no environment credentials, so the
  renderer hands it a media ticket. Main asks it for a tunnel URL per connection, which also makes
  the tunnel follow a route switch.
- **Owner check, not auth.** Chromium can't authenticate to a SOCKS proxy, so any local process
  can connect to the listener and ride this user's tunnel. On Linux the listener looks the client
  up in `/proc/net/tcp` and refuses other users. macOS and Windows have no such check yet. The
  mobile app's device preview has the same listener while it is open: iOS suspends other apps, but
  Android lets any app reach it, and apps cannot see another app's socket owner there.
- **System browser links** have no tunnel. They keep the private-network rewrite in
  [`browserTargetResolver.ts`](../../apps/web/src/browser/browserTargetResolver.ts).

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
