# Socket Control

This document is a current map of Supaterm's socket control path. The source is authoritative.

## Overview

- `SupatermApp` creates a dedicated `StoreOf<SocketControlFeature>` during app initialization and starts socket observation by sending `.task` directly to that store. See `apps/mac/supaterm/App/supatermApp.swift`.
- `SocketControlFeature` owns socket command semantics. It starts the socket runtime through `SocketControlClient`, consumes streamed requests, maps them to terminal operations, and sends structured responses. See `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift`.
- `SocketControlClient` is the dependency boundary between the reducer and the runtime. The live implementation delegates to `SocketControlRuntime.shared`. See `apps/mac/supaterm/Features/Socket/SocketControlClient.swift`.
- `SocketControlRuntime` owns the Unix domain socket transport: endpoint binding, directory creation, stale socket cleanup, `bind`, `listen`, `accept`, request decoding, buffering, and response writes. See `apps/mac/supaterm/Features/Socket/SocketControlRuntime.swift`.
- `TerminalWindowsClient` provides the app-side operations the socket feature can invoke today: debug snapshots, tree snapshots, and pane creation. See `apps/mac/supaterm/Features/Terminal/TerminalWindowsClient.swift`.
- `SupatermCLIShared` owns the shared contract between the app and CLI: environment keys, pane context parsing, endpoint discovery, method names, and typed request/response payloads. See `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`, `apps/mac/SupatermCLIShared/SupatermSocketPath.swift`, and `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`.
- The `sp` CLI resolves a target endpoint, sends requests with `SPSocketClient`, and prints the reducer's response. Current socket-backed commands are `sp ping`, `sp tree`, `sp onboard`, `sp debug`, `sp instances`, and `sp new-pane`. See `apps/mac/sp/main.swift` and `apps/mac/sp/SPSocketClient.swift`.
- `GhosttySurfaceView` injects pane context and the resolved socket path into the terminal process environment. See `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`.

## Environment

- `SUPATERM_SOCKET_PATH`: pane-provided socket location for CLI targeting
- `SUPATERM_INSTANCE_NAME`: optional process display name for endpoint discovery
- `SUPATERM_SURFACE_ID`: current pane surface identifier
- `SUPATERM_TAB_ID`: current pane tab identifier

Definitions live in `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`.

## Endpoint Model

- Each Supaterm app process computes one `SupatermSocketEndpoint` for its lifetime.
- Managed endpoint roots resolve in this order: `XDG_RUNTIME_DIR`, then `TMPDIR`, then `/tmp`.
- If `XDG_RUNTIME_DIR` is set, managed endpoints live under `<XDG_RUNTIME_DIR>/supaterm/pid-<pid>`.
- Otherwise managed endpoints live under `<TMPDIR or /private/tmp>/supaterm-<uid>/pid-<pid>`.
- If `SUPATERM_INSTANCE_NAME` is set, it becomes the endpoint display name. Otherwise the name defaults to `pid-<pid>`.
- `GhosttySurfaceView` injects the process endpoint path into every pane as `SUPATERM_SOCKET_PATH`, so pane-launched `sp` commands route back to the owning process without discovery.

## CLI Target Resolution

- `--socket` wins first.
- If `SUPATERM_SOCKET_PATH` is present in the current process environment, it wins next.
- `--instance` matches a parsed endpoint UUID first, then an exact endpoint name.
- If neither explicit input is present, `sp` discovers managed sockets and auto-selects only when exactly one reachable endpoint exists.
- If zero or multiple reachable endpoints are found, `sp` fails instead of guessing.
- `sp instances` lists all reachable managed endpoints.

## Supported Methods

- `system.ping`: health check, returns `{"pong": true}`
- `system.identity`: returns the app process `SupatermSocketEndpoint`
- `app.debug`: returns a typed `SupatermAppDebugSnapshot` with invocation-resolved current target, app build and update state, per-window space and pane diagnostics, and problem strings
- `app.tree`: returns a typed `SupatermTreeSnapshot` with a `window -> space -> tab -> pane` hierarchy
- `terminal.new_pane`: validates targeting rules, creates a pane through `TerminalWindowsClient`, and returns `SupatermNewPaneResult`

Method names and payload types live in `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`.

## Tree Shape

- `app.tree` returns all spaces in the window, not just the selected space.
- Each window snapshot now contains ordered `spaces`.
- Each space contains:
  - `index`
  - `name`
  - `isSelected`
  - `tabs`
- `Tab` and `Pane` payloads are otherwise unchanged.
- `sp tree` renders the same hierarchy in human-readable form: `window -> space -> tab -> pane`.

## Debug Shape

- `app.debug` returns the same window, space, tab, and pane ordering as `app.tree`, but augments it with stable UUIDs and diagnostic fields.
- The top-level payload also includes build metadata, update state, aggregate counts, current-target resolution from `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID`, and a `problems` array.
- `sp debug` prints local invocation, discovery, and socket diagnostics first, then the remote app snapshot when the socket request succeeds.
- `sp debug --json` wraps the remote snapshot in a local report so unresolved socket failures still return machine-readable diagnostics.

## Pane Targeting

- `terminal.new_pane` explicit targets now resolve as `window -> space -> tab -> pane`.
- Explicit `window`, `space`, `tab`, and `pane` targets are resolved within the requested window and space.
- Explicit socket requests must provide `space` together with `tab`; `pane` still requires `tab`.
- Context-pane targeting still resolves globally through `SUPATERM_SURFACE_ID`.
- `SupatermNewPaneResult` now includes the resolved `spaceIndex`.

## Flow

```text
App side

+------------------+      +----------------------+      +----------------------+
| SupatermApp      | ---> | SocketControlFeature | ---> | SocketControlClient  |
+------------------+      +-----------+----------+      +-----------+----------+
                                     |                                 |
                                     v                                 v
                          +----------------------+          +----------------------+
                          | TerminalWindowsClient|          | SocketControlRuntime |
                          +----------------------+          +----------------------+
                                                                      ^
                                                                      |
CLI side                                                              |

+------------------+      +------------------+                        |
| sp ping/tree/    | ---> | SPSocketClient   +------------------------+
| debug/new-pane   |      +------------------+
+------------------+

Pane path

+------------------------+      +-----------------------------------+      +------------------+
| GhosttySurfaceView     | ---> | SupatermCLIShared                 | ---> | terminal pane    |
+------------------------+      | - SupatermCLIContext              |      +---------+--------+
                                | - SupatermSocketPath              |                |
                                | - SupatermSocketProtocol          |                v
                                +-----------------------------------+             +------+
                                                                                  |  sp  |
                                                                                  +------+
```

## Runtime Notes

- `SocketControlRuntime.start()` creates the socket directory with `0700` permissions.
- If the socket directory already exists and is owned by the current user, startup forces it back to `0700`.
- The socket file is created with `0600` permissions after a successful bind.
- If the path already contains a reachable socket node, startup fails.
- If the path contains an unreachable socket node, the runtime treats it as stale, removes it, and reuses the path.
- If the path is occupied by a non-socket file, startup fails.
- Managed root resolution is shared by endpoint creation, runtime bind, discovery, and `system.identity`, so symlinked temp roots collapse to one canonical path.
- Discovery removes only managed socket paths that fail to connect. Post-connect identity failures are ignored without unlinking the path.
- Requests are newline-delimited JSON messages.
- Replies are newline-delimited JSON responses.
- If the reducer has not started consuming the request stream yet, the runtime buffers requests until `requests()` is observed.

## Code Map

- App startup: `apps/mac/supaterm/App/supatermApp.swift`
- Socket feature semantics: `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift`
- Dependency boundary: `apps/mac/supaterm/Features/Socket/SocketControlClient.swift`
- Unix socket transport: `apps/mac/supaterm/Features/Socket/SocketControlRuntime.swift`
- Socket target resolution: `apps/mac/SupatermCLIShared/SupatermSocketPath.swift`
- Terminal operations exposed to the socket feature: `apps/mac/supaterm/Features/Terminal/TerminalWindowsClient.swift`
- Shared pane environment contract: `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`
- Shared path resolution: `apps/mac/SupatermCLIShared/SupatermSocketPath.swift`
- Shared protocol types: `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`
- Pane environment injection: `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`
- CLI entrypoint: `apps/mac/sp/main.swift`
- CLI socket client: `apps/mac/sp/SPSocketClient.swift`

## Tests

- Reducer tests: `apps/mac/supatermTests/SocketControlFeatureTests.swift`
- Debug target resolution tests: `apps/mac/supatermTests/SupatermDebugSnapshotResolverTests.swift`
- Runtime tests: `apps/mac/supatermTests/SocketControlRuntimeTests.swift`
- Shared protocol and path tests: `apps/mac/supatermTests/SupatermSocketProtocolTests.swift`
- Pane environment contract tests: `apps/mac/supatermTests/SupatermCLIContextTests.swift`
