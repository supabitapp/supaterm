# Environment authentication

The environment issues its own sessions and enforces their capabilities.

## Authority survives transport changes

Pairing delegates a set of scopes. Exchanging a bootstrap credential can narrow
that grant but cannot widen it. The default grant includes access management:
`terminal:operate` is a shell as the server's user and `orchestration:operate`
can start a full-access agent, and either can mint a session with every scope
through `supaterm auth session issue`, so withholding management from the
default would not be a boundary. A narrower client gets explicit scopes.
Every route that returns a credential to the caller requires `access:write` and
every scope that credential carries: a pairing link, an MCP sign-in approval, and
a link code from a linked environment. The [auth handlers](../../apps/server/src/auth/http.ts) enforce this
at issuance; client labels and device metadata have no authorization role.
Unknown scope strings, whether requested or stored, are dropped rather than
rejected, so clients and records from other versions keep working.

Project scripts need `orchestration:operate`. The host runs a saved project
script itself, on worktree creation and on done, so saving one needs
`orchestration:operate` on top of `settings:write`, whether it arrives in a
settings patch or a project update. Clients resend a project's whole override
entry when they change any of its settings, so the server compares a patch's
scripts with the saved ones and charges only for a change. Dropping a project's
override is a change, because the project then runs the environment's scripts.
The socket's check reads settings before the write takes its lock, so the write
repeats the comparison against the settings it replaces.

The access read model contains pairing metadata, never recoverable pairing
secrets. Only the creation response returns the raw credential. Otherwise read
access to the connections list would become a way to acquire another client's
authority.

Browser cookies and bearer tokens adapt the same scoped session model. The OAuth
token-exchange vocabulary gives these grants a familiar meaning.

[Peer link](remote.md#peer-links) sessions and bearer sessions paired from a
plain pairing link (`one-time-token` or `pairing-link:<id>`, issued to a client
rather than a server-issued bot) renew on use: their bearer tokens are never
reissued, so the session row alone holds their deadline and the token's own
expiry is ignored. Authenticating a call from one
moves the row 30 days out, at most once a day so a busy client does not write on
every call. An open WebSocket counts as use, so a pairing-link socket renews its
session a day before the deadline instead of being closed; if that write fails
the socket keeps watching for a revoke until the deadline. Only an unexpired,
unrevoked row moves, so an idle client still ends after 30 days and a revoke is
final. Upstream renews pairing links only through a DPoP token exchange; this
fork has no DPoP, so they renew like peer links, and sessions paired before the
upgrade renew too. CLI, desktop, startup-link, dev-token and cookie sessions, and
other MCP clients, keep the fixed lifetime their token carries, so rotating a
credential still cuts a device off.

### MCP clients are a separate audience

Agents Supaterm did not launch sign in to `/mcp` through a narrow OAuth
authorization-code server ([McpOAuth](../../apps/server/src/auth/McpOAuth.ts)).
It accepts loopback redirect URIs for agents on the user's machine and any
HTTPS redirect for hosted agents (ChatGPT, bots). An HTTPS redirect means a
link someone else sends the owner can deliver access to that someone, so the
approval page names the host access goes to and approving stays the owner's
call. Every client is public and proves itself with PKCE; a client that asks
for a secret is registered without one. Client registration is stateless, so an unauthenticated caller cannot grow server
state. Approval spends a one-time pairing code, or uses a browser session with
`access:write`.

The user grants either read-only access or a runtime-mode ceiling, not a
scope list: MCP tools are all orchestration, and `orchestration:operate`
alone would let an agent start a thread in full access and act through it.
The result is an ordinary session with subject `mcp-client`. A read-only
grant holds `orchestration:read` alone. On `/mcp` it passes only tools
declared as reads in [McpToolAccess](../../apps/server/src/mcp/McpToolAccess.ts),
where every tool must declare who may call it to compile. Any other grant adds
`orchestration:operate` and a signed ceiling. Only `/mcp` accepts these sessions, and for a
[peer link](remote.md#peer-links)'s session alone the thread routes in
[linkThreadHttp](../../apps/server/src/peer/linkThreadHttp.ts), which only read, and the
client pairing described below. Every other HTTP and WebSocket
path rejects that subject, because the RPC surface would let the agent act
above its ceiling. Inside MCP the credential sets the limits and tool
parameters only pick targets; see
[threadAccess](../../apps/server/src/mcp/threadAccess.ts).

These clients have no calling thread, so `/mcp` does not offer them tools that
act as one, such as `request_secret` or `delegate_task`. Hiding is only
discovery: the handlers still refuse such a call with
`thread_credential_required`. A secret card belongs to a thread's run, so an
outside agent that needs a secret starts a thread and lets that agent ask.

A full-access [peer link](../../apps/server/src/peer/PeerClientPairing.ts) may
mint a one-time pairing for a client of the environment that holds it. Its
agents already run as this machine's user and could run `supaterm auth pairing create`,
so this adds no authority; a narrower link would gain some, so it is refused
here, on the linked side, whatever the linking side sent. The pairing carries
the client's scopes on the linking environment intersected with a normal
pairing's. A person starts it: the linking environment exposes it as a WebSocket
RPC behind `access:write`, and the linked side as an HTTP route that accepts only
a link's session. It is not an MCP tool, because a tool is reachable by whatever
holds a thread credential, and hiding one from tool listings is only discovery.
The same route mints a code that links another environment at a chosen access
level, and the linking side's RPC requires the caller to hold that level's scopes.

Issuer and resource URLs come from the request's Host and
`X-Forwarded-Proto`, so one server answers over loopback and Tailscale Serve. A proxy that rewrites Host or drops the protocol header
breaks sign-in.

Bearer clients obtain short-lived WebSocket tickets through authenticated
HTTP so long-lived tokens stay out of socket URLs. A ticket names the route it
opens: the RPC socket, or the media routes (device hub, preview stream), which
share one ticket across `<img>`, `EventSource` and several sockets, so a leaked
media ticket cannot open the RPC socket. Clients that predate this, and the
relay tunnel, mint unbound tickets that open either route. Browser sessions can
authenticate the upgrade with their cookie. A successful handshake grants no
extra authority: [every RPC declares a required
scope](../../apps/server/src/auth/RpcAuthorization.ts), and the WebSocket RPC
group's `RpcScopeAuthorization` middleware checks it before any handler runs.

A request that names a secret for the server to read needs `providers:manage` on top of its
method's scope, whether the secret reference is saved in settings or used once, as in a secret
request answered with a reference. A reference can name any secret the provider's account holds,
and the server sends what it reads wherever the field points, such as a source control host.
Typed values need only the method's scope. Clients hide the secret provider picker from sessions
without it.

Scope changes must not prevent older clients from connecting. Token exchange
intersects recognized requests with the pairing grant; retired and unknown names
are dropped. A request with no granted scopes fails before consuming the link.
Stored credentials are never expanded when scopes split.

Auth responses keep `scopes` within the original wire vocabulary and include
`permissions` for the exact grant. New clients use `permissions` when present,
even if empty. Older servers omit it, so clients use legacy parent checks for
features those servers already support. These client checks never change server
authorization. Permission errors likewise retain a legacy `requiredScope` and
add the exact `requiredPermission`, so a denied RPC stays decodable by old clients.
Unknown response permissions are ignored; grant inputs stay strict.

Desktop restarts forget the previous local bearer token, so its reusable
bootstrap grant replaces earlier sessions for the same subject and method.
Revocation and insertion share a [database
transaction](../../apps/server/src/persistence/AuthSessions.ts); a failed
replacement must leave the old credential usable. Pairing and browser sessions
do not follow this replacement rule.

### Reusable dev credential

Web development environments can accept one `SUPATERM_DEV_AUTH_TOKEN` across
worktrees and ports on one hostname. The token and startup URLs that contain it
grant administrative access. Desktop and non-development servers ignore it. See
the [development runbook](../operations/development.md#reusable-dev-credential)
for setup.

Each environment hashes the value and seeds its own database record at startup.
Environments do not share SQLite data, signing keys, environment IDs, session
records, pairing grants, or revocation state. Local revocation persists after
restart and does not affect another worktree. Removing or rotating the value
and restarting invalidates the old credential and its WebSocket tickets.

Normal credentials keep precedence. A rejected normal credential never falls
back to the reusable credential. OAuth exchanges create ordinary local bearer
children with normal expiry and revocation. The reusable cookie expires after 30
days.

## The environment is the filesystem boundary

Projects are organizational boundaries, not filesystem sandboxes.
`filesystem:read` permits reading files the server account can read, including
absolute paths outside a project. This lets clients display artifacts that an
agent writes in a temporary directory. Relative paths and writes still follow
the [workspace path rules](../../apps/server/src/workspace/WorkspaceFileSystem.ts).

Signed asset URLs are bearer credentials. A URL for media on the host grants
access to one canonical file and its device/inode identity, not its containing directory.
[Asset access](../../apps/server/src/assets/AssetAccess.ts) rechecks the opened
file's identity when serving it, so atomic replacement requires a new URL while
editing the same file in place does not. An HTML file authorized this way cannot
load sibling assets; directory-scoped workspace previews are a separate grant.
Clients should share the authored file reference so they do not disclose the
temporary URL's credential. `filesystem:read` is checked when the URL is minted,
not when it is served: a URL issued before the grant was revoked keeps working
until it expires, and it is not bound to the session that minted it.

Host videos can change in place. Their [HTTP
responses](../../apps/server/src/http.ts) omit cache validators because file
metadata cannot prove byte-for-byte identity for `If-Range`. Adding weak
validators would turn native-player seeks into full downloads.
