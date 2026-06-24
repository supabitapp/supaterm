# cmux SSH Architecture — Investigation

How `manaflow-ai/cmux` implements remote SSH workspaces, reconstructed from source
(Swift app + CLI, plus the Go `daemon/remote/cmd/cmuxd-remote`) and
`daemon/remote/README.md`. The public `cmux.com/docs/ssh` page is mostly i18n-key
prose + a demo video; the real detail is in the code.

## Core idea

`cmux ssh user@host` does **not** just shell out to ssh and hand you a terminal. It
turns a remote machine into a first-class cmux *workspace* by running a small Go
daemon (`cmuxd-remote`) on the far side and speaking **newline-delimited JSON-RPC**
to it. Keystrokes still go over a normal interactive ssh PTY (the daemon is
explicitly *not* in the keystroke hot path); everything else — browser panes, the
remote `cmux` CLI, port/notification awareness, reconnect — rides side channels.

## Transport: one ssh connection, multiplexed

```
ssh -o ConnectTimeout=6 -o ServerAliveInterval=20 -o ServerAliveCountMax=2
    -o SetEnv COLORTERM=truecolor -o SendEnv TERM_PROGRAM ...
    -o ControlMaster=auto -o ControlPersist=600
    -o ControlPath=/tmp/cmux-ssh-<uid>-<relayPort>-%C
    -o StrictHostKeyChecking=accept-new
    -o PermitLocalCommand=yes -o LocalCommand=<reconnect-signal>
    user@host
```

- `ControlMaster=auto` + `ControlPersist=600` → first connection opens a control
  socket; scp drops (drag-and-drop upload) and auxiliary `ssh` calls reuse it
  without re-authenticating.
- Preflight runs `ssh -G` to read the resolved `ControlPath`, checks it with
  `ssh -S … -O check`, and `rm`s it only if stale and only if it matches the
  cmux-owned `/tmp/cmux-ssh-*` pattern — avoids "address already in use".
- User-supplied `-o` always wins; defaults injected only when the key is absent
  (case-insensitive check).

## Bootstrap: getting the daemon onto the box

**Plain SSH host** — daemon uploaded on demand. The app ships a manifest baked into
`Info.plist` listing per-platform GitHub Release asset URLs + **pinned SHA-256**
digests for `darwin/{arm64,amd64}` and `linux/{arm64,amd64}`. It downloads+caches the
matching binary, verifies the digest, then uploads to `~/.cmux/bin/...`. A
base64-encoded bootstrap shell script is piped over an `ssh -T` exec channel, written
to `~/.cmux/relay/<port>.bootstrap.sh`, then run via `RemoteCommand`.
(`CMUX_REMOTE_DAEMON_ALLOW_LOCAL_BUILD=1` lets dev builds `go build` instead.) Audit
what a build trusts with `cmux remote-daemon-status --os linux --arch amd64`.

**Cloud VM (Freestyle/E2B)** — `skipDaemonBootstrap=true`. Daemon is pre-baked and
started by systemd on `/run/cmuxd-remote.sock`; the app skips upload/exec, opens
`ssh -N -L 127.0.0.1:<port>:/run/cmuxd-remote.sock`, and synthesizes a `DaemonHello`.

The binary is busybox-style: invoked as `cmux` (symlink) it auto-dispatches to its
`cli` subcommand; otherwise `serve --stdio` (normal) or `serve --ws` (cloud only).

## RPC protocol

Newline-delimited JSON over the ssh exec channel's stdio (64KB reader, 4MB max frame):

```go
rpcRequest{ ID, Method, Params map[string]any }
rpcResponse{ ID, OK bool, Result, Error *{Code,Message} }
rpcEvent{ Event, StreamID, DataBase64, Error }   // async push
```

Client sends `hello` first; daemon answers with version + capabilities
(`session.basic`, `session.resize.min`, `proxy.http_connect`, `proxy.socks5`,
`proxy.stream.push`, …). Methods: `ping`, `proxy.open/close/write/stream.subscribe`,
`session.open/close/attach/resize/detach/status`.

## Browser panes

A browser pane bound to a remote workspace reaches services on the *remote's* network
with no manual `-L` forwarding. The **local** cmux app runs a SOCKS5 + HTTP-CONNECT
broker on loopback; the browser uses it as its proxy. The broker translates each
connection into `proxy.open {host,port,timeout_ms}` → `stream_id`, writes base64
`proxy.write`, and `proxy.stream.subscribe`s for **pushed** `proxy.stream.data/eof/error`
events (no polling). The daemon does the actual TCP dial on the remote with
`SetNoDelay(true)`. SOCKS/CONNECT parsing is local; the daemon only moves bytes.

## CLI relay (`cmux` works inside the ssh session) + HMAC auth

Running `cmux …` on the remote controls *your local* app — the remote never touches
the real local Unix socket:

1. Each workspace gets a random `relay_id` + 32-byte `relay_token`.
2. A background `ssh -N -R` reverse-forwards a remote TCP port to a **local loopback
   relay server**.
3. Remote address written to `~/.cmux/socket_addr`; credentials to
   `~/.cmux/relay/<port>.auth` (mode `0600`, deleted on stop).
4. The relay server demands an **HMAC-SHA256 challenge-response** before forwarding:
   - challenge: `{protocol:"cmux-relay-auth", version:1, relay_id, nonce}`
   - client: `mac = HMAC-SHA256(token, "relay_id=<id>\nnonce=<n>\nversion=1")`,
     replies `{relay_id, mac}`.

Socket discovery order: `--socket` → `CMUX_SOCKET_PATH` → `~/.cmux/socket_addr`.

## Sessions, resize, reconnect

- Sessions are in-memory in the daemon (`map[id]*sessionState`), reattachable by
  reusing `session_id`. The shell is an independent PID, surviving client disconnects.
- **Resize: smallest-screen-wins.** Each `session.attach` registers a viewport;
  effective PTY size = min across attachments; on full detach it keeps `lastKnownSize`
  rather than snapping to 80×24.
- Reconnect is driven by the bootstrap shell wrapper, not the daemon: a `while` loop
  relaunches ssh, retrying **only on exit 255** (disconnect), default
  **20 attempts × 2s** (`CMUX_SSH_RECONNECT_LIMIT` / `_DELAY_SECONDS`). On give-up it
  prints a "VM may have been paused/destroyed" message and waits for Enter.
  `ssh-session-end` RPC tears down the relay forward.

## Cloud-only WebSocket PTY

`serve --ws` (cloud images) refuses to start without `--auth-lease-file`. Client hits
`/terminal`, sends text auth frame `{type:"auth",token,session_id,cols,rows}`; after
`{type:"ready"}` binary frames are PTY I/O and text frames are control
(`{type:"resize",...}`). Leases are short-lived, single-use (`token_sha256`,
`expires_at_unix`), consumed before the shell spawns so replays get "no active lease".
E2B images set `allowPublicTraffic:false`, so provider auth gates the request before
the daemon sees it.

## Agents on the remote

`cmux claude-teams` / `omo` / `omx` / `omc` launch coding agents via a **tmux shim**:
a fake `tmux` on `PATH` that forwards to `cmux __tmux-compat`, translating tmux calls
into cmux RPC (`workspace.create`, splits), state in
`~/.cmuxterm/tmux-compat-store.json`. The launcher sets
`TMUX`/`TMUX_PANE`/`CMUX_SOCKET_PATH`/`CMUX_WORKSPACE_ID`, resolves the real agent
binary, then `syscall.Exec`s into it — so agent hooks calling `cmux notify` light up
the local sidebar.

## Deep links

`cmux://ssh?host=…&user=…&port=…&server-alive-interval=…` (also `cmux-nightly://`,
`https://cmux.com/deeplink/ssh?` fallback). Strictly validated (host ≤256 chars,
charset whitelist, control chars + leading-dash rejected to block flag injection),
translated into the same CLI args, then a **trust dialog** shows the exact command and
requires "I trust this SSH target" before connecting.

---

# Pane ↔ TTY binding (how individual panes stay addressable over one SSH relay)

## The problem SSH creates

Over SSH every remote pane's `cmux` CLI funnels through **one** reverse-forwarded
relay socket. So when an agent in some pane runs `cmux notify` or a port scan fires,
the app must know *which pane* — but the socket is shared and surface IDs aren't known
to arbitrary remote processes. cmux binds each pane to its **tty name** and
reverse-resolves the tty back to a `(workspace, surface)` pair.

## Forward path — each pane registers its tty

**At bootstrap**, the spawned shell captures its tty and pushes it over the relay
(`CLI/cmux.swift:5779–5787`):

```sh
cmux_bootstrap_tty="$(tty)"
env -u CMUX_SOCKET CMUX_SOCKET_PATH=127.0.0.1:<relayPort> \
  cmux rpc surface.report_tty \
  '{"workspace_id":"…","surface_id":"…","tty_name":"'$cmux_bootstrap_tty'"}'
```

**On every prompt**, the shell integration re-reports
(`Resources/shell-integration/cmux-zsh-integration.zsh:114`,
`_cmux_report_tty_via_relay`) keyed on `CMUX_PANEL_ID`.

The app handler (`TerminalController.swift:2618`/`5245`) stores it:

```swift
tab.surfaceTTYNames[surfaceId] = ttyName   // [UUID: String] on Workspace
```

For **remote** workspaces the surface may not exist locally when the tty first
arrives, so it is stashed via `rememberPendingRemoteSurfaceTTY(...)` and applied once
the surface materializes (`TerminalController.swift:5220`, returns `pending:true`).

## Reverse path — a command resolves *its own* pane

`CLI/cmux.swift:17434–17467`:

```swift
resolveCallerTTYName():            // env CMUX_CLI_TTY_NAME / CMUX_TTY_NAME / TTY / SSH_TTY,
                                   //   then ttyname(STDIN/OUT/ERR)
resolveCallerTerminalBindingByTTY: // sendV2("debug.terminals") → match normalized tty
                                   //   → CallerTerminalBinding{workspaceId, surfaceId}
```

`normalizedTTYName` strips the path (`/dev/pts/3` → `3`) and rejects `"not a tty"`, so
local `ttys001` and remote `pts/N` names normalize consistently. This binding fills in
omitted `workspace_id`/`surface_id` on nearly every command
(`resolveWorkspaceIdAllowingFallback` / `resolveSurfaceIdAllowingFallback`,
`CLI/cmux.swift:17372`/`:17389`) — why `cmux split`, `cmux notify`, etc. target the
pane you typed them in without passing IDs.

## What the binding powers

- **Notifications** — `notification.create_for_caller` takes `caller_tty` +
  `prefer_tty` and routes via `targetForTTY`
  (`Sources/TerminalNotificationCallerResolver.swift:127`), falling back through
  preferred workspace → focused panel if no tty match.
- **Port detection** — each shell also sends `surface.ports_kick`. `PortScanner`
  (`Sources/PortScanner.swift`) coalesces kicks across all panes (200ms timer → burst
  of 6 scans) and runs **one** batched `ps -t <ttys>` + `lsof -p <pids>` covering
  every pane; the tty is the join key.
- **Image transfer** — `Sources/TerminalImageTransfer.swift:491` looks up
  `surfaceTTYNames[id]` to target the right pane.

## SSH-specific twist

Local panes scan with `PortScanner.shared.registerTTY(...)` (local `ps`/`lsof`). For
remote workspaces the ttys live on the far host, so it diverts
(`TerminalController.swift:5246`):

```swift
if tab.isRemoteWorkspace {
    tab.syncRemotePortScanTTYs()              // push tty set to the daemon side
    tab.applyPendingRemoteSurfacePortKickIfNeeded(to: surfaceId)
} else {
    PortScanner.shared.registerTTY(...)
}
```

`updateRemotePortScanTTYs(surfaceTTYNames)` (`Workspace.swift:9310`) hands the
per-surface tty map to the remote session controller, so `ps`/`lsof` run **on the
remote** and report ports back per surface — same pane-tap model, executed across the
wire.

---

**Summary.** cmux multiplexes a single OpenSSH connection (ControlMaster) into (1) a
normal interactive PTY, (2) a JSON-RPC channel to an uploaded, SHA-256-pinned Go
daemon for byte-proxying browser traffic, and (3) an HMAC-authenticated reverse-tunnel
relay so the remote `cmux` CLI safely drives the local app. Each pane stays
individually addressable by binding `surface_id ↔ tty` (reported at bootstrap and
every prompt) and reverse-resolving any remote command's own tty back to its surface
via `debug.terminals` — which drives notification routing, batched port scanning, and
image targeting, with port scans relocated to the remote host for SSH workspaces.

Source: [github.com/manaflow-ai/cmux](https://github.com/manaflow-ai/cmux)
(`daemon/remote/README.md`, `CLI/cmux.swift`, `CLI/CMUXCLI+SSHCommandSupport.swift`,
`Sources/Workspace*`, `Sources/TerminalController.swift`,
`Sources/TerminalNotificationCallerResolver.swift`, `Sources/PortScanner.swift`,
`daemon/remote/cmd/cmuxd-remote/*.go`).
