# Connection runtime

Web, the desktop renderer, and mobile share one connection owner per environment
in `packages/client-runtime`. Platform code supplies storage, credentials, network
signals, and application lifecycle events. React views consume the runtime.
Keeping retries and session lifetime here prevents competing reconnect loops when
several views need the same environment.

## One transport retry owner

The [supervisor](../../packages/client-runtime/src/connection/supervisor.ts) owns
transport retry policy; resolving an endpoint and opening an RPC session are single
attempts. Transient failures retry with jittered exponential backoff, capped at
30 seconds, that resets only after a connection stays up. Jitter, not the cap,
keeps every client of a restarted server from reconnecting in the same second.
The cap bounds how long a client stays idle after its host becomes reachable
again, which no signal reports while the network interface stays up; it matches
the host's own relay reconnect cap. Offline states and authentication failures
wait for a wakeup instead of spending attempts on unchanged conditions, so the cap
only paces failures that may clear on their own.

Foregrounding, an explicit retry, and an offline report probe the established
session, and only a failed probe reconnects. Offline reports are often wrong, for
example for a loopback server. Mobile resume uses a short probe and preserves a
healthy session so its subscriptions can resume without downloading another
shell snapshot. A failed resume probe permits one immediate connection attempt
even while the network reports offline. Returning to mobile also restarts an
in-flight connection attempt, whose routes may belong to the previous network.
Desktop foregrounding leaves ordinary in-flight attempts alone.

A replacement session to the same server process may resume the shell from the
in-memory cursor instead of reloading the HTTP snapshot. Resume covers only rows
with events after the cursor, but some thread rows read another thread's state: a
fork counts its source's items, threads bound to one provider session share its
last error, and a provider-thread move changes the previous owner. Neither resume
nor the live tail resends those rows. A reload on every reconnect used to repair
them, so a new session resumes only while the last authoritative snapshot is
younger than six hours.

The native mobile relay, not the supervisor, decides when a backgrounded tunnel
suspends. iOS suspends when its background task expires, so the tunnel lasts as
long as the OS grants. Android has no such deadline, so it suspends after a fixed
grace instead of holding the tunnel and its keepalives until the process is
frozen or killed, which can take hours on devices without the cached-app
freezer. Where the freezer runs, it usually ends the tunnel first. On foreground
the relay probes its tunnel before the RPC probe times out, because an RPC
session replacement alone cannot repair a dead native tunnel. While mobile is
backgrounded, the supervisor retains established
sessions but parks connection attempts and retries. Expected background
disconnects do not become connection failures in the foreground UI.

Native tunnels ([iOS](../../apps/mobile/modules/supaterm-relay-tunnel/Sources/RelayTunnelCore/RelayTunnel.swift),
[Android](../../apps/mobile/modules/supaterm-relay-tunnel/android/src/main/java/expo/modules/supatermrelaytunnel/core/NativeTunnel.kt))
never retry on their own. A relay attempt that fails before its session is up
answers every waiting loopback request with a 5xx carrying `X-Supaterm-Relay-Error`,
and requests in the next two seconds get the same answer without dialing. After
that, the next loopback request dials again. A tunnel cannot see a client abandon
a loopback request, so a tunnel-side retry loop keeps dialing an offline host long
after the client gave up. Offline hosts answer 503 rather than 404, because a
declared 404 blocks the environment.

The [registry](../../packages/client-runtime/src/connection/registry.ts) scopes
connections by environment. An involuntary disconnect retains the registration
and cached data. Explicit removal closes the scope and clears credentials,
projections, and platform-owned state such as drafts.

## Protocol version gate

Clients and servers must agree on `ORCHESTRATION_PROTOCOL_VERSION`. The client runtime appends
`orchestrationProtocol=<version>` to the socket URL, and the `/ws` route rejects a missing or
mismatched version with HTTP 426 (`orchestration_protocol_incompatible`) before any RPC or auth
work runs. The client checks the environment descriptor the same way. Either direction blocks the
connection as `unsupported` with a message naming the machine to update rather than running
half-upgraded. See `packages/client-runtime/src/connection/compatibility.ts` and
`apps/server/src/ws.ts`. The descriptor is decoded before the comparison, so it must read any newer
server's descriptor: a decode failure there replaces the update message with a generic error.

## HTTP authorization

RPC sessions authenticate at socket upgrade, while HTTP requests need current
credentials from the
[authorization service](../../packages/client-runtime/src/authorization/service.ts).
Replacing a healthy socket for HTTP renewal would interrupt conversations and
change the transport generation without a transport failure. Credential expiry
does not close the socket, and refresh failure belongs to the HTTP operation.

Session listings must retain unrevoked connected sessions after credential expiry
so an open connection does not disappear from connection management. This does
not extend the credential's lifetime. New HTTP requests and socket upgrades still
require valid credentials.

## Transport health and data freshness are separate

A socket opening is insufficient evidence that the environment is usable. The
[RPC session](../../packages/client-runtime/src/rpc/session.ts) waits for the
initial server configuration before becoming ready. Shell and thread data then
have their own synchronization state. A failed shell subscription can coexist
with a healthy connection; labeling that state "reconnecting" promises a
transport retry that will never happen.

Cached projections remain readable offline. They must neither imply a live
connection nor overwrite newer live data during a reconnect. Loading and
resuming snapshots belongs to the shared state services, so every view agrees
on which data is current.

[Thread detail](../../packages/client-runtime/src/state/threads.ts) separates
subscription lifetime from cache lifetime. Mounted consumers share one live
stream, which stops when the last consumer unmounts; hidden mounted routes still
count. A registry-local cache retains state and its replay cursor for five idle
minutes so back navigation can resume without another snapshot download.

The desktop and mobile apps add one consumer: a shared
[keep-alive](../../packages/client-runtime/src/state/threadKeepAlive.ts) mounts every thread whose
session is starting or running, in each enabled environment. Opening a running
thread then needs no replay. The shell and detail streams are independent, so
the shell can report a stop before the detail loads or catches up. A stopped
thread stays mounted until its own stream is live and shows the stop, and the
stream then closes and saves the settled state.
The web client does not mount this keep-alive.

Retain state and cursor together only after an update finishes. Cancellation must
not advance the cached cursor beyond the applied data, and an old scope must not
overwrite its successor's cache. Preserve pagination data on reuse, but clear
canceled loading state.

The [RPC boundary](../../packages/client-runtime/src/rpc/client.ts) resolves
requests against the current session at execution time. Durable subscriptions
follow replacement sessions. After a transport failure they wait for the
supervisor; an expected domain failure may resubscribe on the same healthy
session. Reconnection does not automatically replay mutations, whose retry and
idempotency rules belong to the operation.
