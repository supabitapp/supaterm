# Socket Control

This document captures the stable rules of Supaterm's socket IPC. The source remains authoritative for concrete APIs and current command surfaces.

## Model

- Each running Supaterm app process owns one Unix domain socket endpoint.
- Each endpoint has an ID, name, path, pid, and start time.
- The app and CLI share one protocol contract for endpoint identity, discovery, requests, and responses.
- Pane-launched CLI processes are wired back to the owning app through injected environment, so the common path does not require discovery.
- CLI invocations outside Supaterm can discover managed endpoints, but they never select when resolution is ambiguous.

## Endpoint Identity

- `SUPATERM_INSTANCE_NAME` names the app process endpoint.
- Unnamed app processes use `default`.
- Managed socket filenames include a normalized instance name, a stable name hash, and the process ID.
- `sp instance ls` lists reachable managed endpoints.
- `sp instance ls --json` returns endpoint IDs for unambiguous targeting.

## Target Resolution

Socket selection and terminal object targeting are separate.

Socket selection order:

1. `--socket <path>`
2. `SUPATERM_SOCKET_PATH`
3. `--instance <name-or-endpoint-id>`
4. The single reachable discovered endpoint

Terminal object targeting happens after socket selection:

- Pane context comes from `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID`.
- Inside Supaterm, commands can omit targets such as `sp tab new`, `sp pane split`, `sp tab focus`, and `sp pane focus`.
- Outside Supaterm, pass selectors, UUIDs, or `--in` targets.
- The CLI resolves public selectors from a fresh tree and sends stable object IDs.
- The app resolves those IDs against live state when it runs the command, so an index change cannot retarget a queued command.

Discovery rules:

- Managed socket discovery stays scoped to the current user.
- Discovery probes managed socket files and removes stale managed sockets.
- Reachable sockets are never silently replaced.
- If multiple reachable endpoints exist, the CLI requires `--instance` or `--socket`.
- If more than one endpoint has the requested name, pass the endpoint ID or `--socket`.

## Request Handling

- Requests and replies are newline-delimited JSON objects.
- Transport concerns and command semantics are split cleanly.
- The transport layer owns socket lifecycle, buffering, and I/O.
- The app-side control layer interprets requests and produces typed responses.
- Responses carry the original request ID, an `ok` flag, and either `result` or `error`.
- Unknown methods return `method_not_found`.
- Bad request shapes return `invalid_request`.

## Terminal Topology

- Socket operations target the live terminal model exposed by the app.
- Explicit hierarchical selectors resolve in window, then space, then tab, then pane order before the request is sent.
- Pane-context targeting is available when the CLI is launched from inside Supaterm.
- Public selectors are 1-based:
  - Space: `1`
  - Tab: `1/2`
  - Pane: `1/2/3`
- UUIDs are accepted anywhere the matching command accepts a space, tab, or pane.
- Creation commands return typed IDs: `spaceID`, `tabID`, and `paneID`.

## Public CLI Surface

Tree and diagnostics:

```bash
sp ls
sp ls --json
sp onboard
sp diagnostic
sp instance ls
```

Connection flags:

```bash
sp ls --instance work-mac
sp diagnostic --socket /path/to/socket
sp pane capture --instance 2F4D3B19-91EC-4F78-9BCE-6F3F4E301E59 1/2/3
```

Terminal control:

```bash
sp space new --focus Work
sp tab new --in 1 --cwd ~/tmp -- ping 1.1.1.1
sp pane split --in 1/2 right
sp pane send --newline 'echo hello'
sp pane capture --scope scrollback --lines 200
sp pane layout main-vertical 1/2
sp pane health 1/2/3
sp pane wait-ready 1/2/3
```

Compatibility and config:

```bash
sp run -- zsh -lc 'echo hi'
sp tmux list-panes
sp config get updates.channel
sp config set appearance.mode system
sp config validate
```

## Runtime Guarantees

- Managed socket paths are created under `XDG_RUNTIME_DIR` when it fits the Unix socket path limit.
- If `XDG_RUNTIME_DIR` is unavailable or too long, Supaterm falls back through `TMPDIR` and then `/tmp`.
- Managed socket directories are per-user.
- Stale managed sockets can be removed.
- Path resolution is canonicalized so endpoint creation, discovery, and identity agree on the same location.
- Incoming requests can be buffered briefly until the app starts consuming the stream.
- Socket path generation respects the platform `sockaddr_un.sun_path` byte limit.

## Method Families

The full method list lives in `SupatermSocketMethod` (`apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`):

- `app.*` — onboarding, debug, tree, settings
- `system.*` — identity, ping
- `terminal.agent_hook` — coding agent hook events
- `terminal.*` — space, tab, and pane control, one method per CLI verb

## Code Index

- `apps/mac/supaterm/SocketFeature/` is the app-side socket boundary.
- `apps/mac/supaterm/SocketFeature/SocketControlFeature.swift` owns request semantics.
- `apps/mac/supaterm/SocketFeature/SocketControlRuntime.swift` owns socket lifecycle and transport.
- `apps/mac/SupatermCLIShared/` holds the shared IPC contract.
- `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift` defines methods and the request and response envelope.
- `apps/mac/SupatermCLIShared/SupatermSocketTerminalPayloads.swift`, `SupatermSocketSnapshots.swift`, and `SupatermSocketNotifications.swift` define the payload types.
- `apps/mac/SupatermCLIShared/SupatermSocketPath.swift` defines endpoint resolution and discovery.
- `apps/mac/SupatermCLIShared/SupatermCLIContext.swift` defines pane context passed through environment.
- `apps/mac/SPCLI/` is the shared CLI implementation surface.
- `apps/mac/sp/main.swift` is the CLI entrypoint.
- `apps/mac/SPCLI/SPSocketClient.swift` is the CLI transport client.
- `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` injects pane context into terminal processes.
