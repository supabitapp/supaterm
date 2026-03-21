# Socket Control

This document is a current map of Supaterm's socket control path. The source is authoritative.

## Overview

- `SupatermApp` creates a dedicated `StoreOf<SocketControlFeature>` during app initialization and starts socket observation by sending `.task` directly to that store. See `apps/mac/supaterm/App/supatermApp.swift`.
- `SocketControlFeature` owns socket command semantics. It starts the socket runtime through `SocketControlClient`, consumes streamed requests, maps them to terminal operations, and sends structured responses. See `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift`.
- `SocketControlClient` is the dependency boundary between the reducer and the runtime. The live implementation delegates to `SocketControlRuntime.shared`. See `apps/mac/supaterm/Features/Socket/SocketControlClient.swift`.
- `SocketControlRuntime` owns the Unix domain socket transport: path resolution, directory creation, stale socket cleanup, `bind`, `listen`, `accept`, request decoding, buffering, and response writes. See `apps/mac/supaterm/Features/Socket/SocketControlRuntime.swift`.
- `TerminalWindowsClient` provides the app-side operations the socket feature can invoke today: debug snapshots, tree snapshots, and pane creation. See `apps/mac/supaterm/Features/Terminal/TerminalWindowsClient.swift`.
- `SupatermCLIShared` owns the shared contract between the app and CLI: environment keys, pane context parsing, socket path resolution, method names, and typed request/response payloads. See `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`, `apps/mac/SupatermCLIShared/SupatermSocketPath.swift`, and `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`.
- The `sp` CLI resolves the socket path, sends requests with `SPSocketClient`, and prints the reducer's response. Current socket-backed commands are `sp ping`, `sp tree`, `sp debug`, and `sp new-pane`. See `apps/mac/sp/main.swift` and `apps/mac/sp/SPSocketClient.swift`.
- `GhosttySurfaceView` injects pane context and the resolved socket path into the terminal process environment. See `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`.

## Environment

- `SUPATERM_SOCKET_PATH`: optional socket path override and pane-provided socket location
- `SUPATERM_SURFACE_ID`: current pane surface identifier
- `SUPATERM_TAB_ID`: current pane tab identifier

Definitions live in `apps/mac/SupatermCLIShared/SupatermCLIContext.swift`.

## Socket Path Resolution

- `SupatermSocketPath.resolve` prefers an explicit path first.
- If no explicit path is provided, it uses `SUPATERM_SOCKET_PATH` from the environment.
- If neither is set, it falls back to `Application Support/Supaterm/supaterm.sock`.

This logic is shared by the app runtime, the CLI, and pane-launched commands.

## Supported Methods

- `system.ping`: health check, returns `{"pong": true}`
- `app.debug`: returns a typed `SupatermAppDebugSnapshot` with invocation-resolved current target, app build and update state, per-window workspace and pane diagnostics, and problem strings
- `app.tree`: returns a typed `SupatermTreeSnapshot` with a `window -> workspace -> tab -> pane` hierarchy
- `terminal.new_pane`: validates targeting rules, creates a pane through `TerminalWindowsClient`, and returns `SupatermNewPaneResult`

Method names and payload types live in `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift`.

## Tree Shape

- `app.tree` returns all workspaces in the window, not just the selected workspace.
- Each window snapshot now contains ordered `workspaces`.
- Each workspace contains:
  - `index`
  - `name`
  - `isSelected`
  - `tabs`
- `Tab` and `Pane` payloads are otherwise unchanged.
- `sp tree` renders the same hierarchy in human-readable form: `window -> workspace -> tab -> pane`.

## Debug Shape

- `app.debug` returns the same window, workspace, tab, and pane ordering as `app.tree`, but augments it with stable UUIDs and diagnostic fields.
- The top-level payload also includes build metadata, update state, aggregate counts, current-target resolution from `SUPATERM_SURFACE_ID` and `SUPATERM_TAB_ID`, and a `problems` array.
- `sp debug` prints local invocation and socket diagnostics first, then the remote app snapshot when the socket request succeeds.
- `sp debug --json` wraps the remote snapshot in a local report so unresolved socket failures still return machine-readable diagnostics.

## Pane Targeting

- `terminal.new_pane` is unchanged at the request and response level.
- Explicit `window` and `tab` targets are resolved within the currently selected workspace.
- Context-pane targeting still resolves globally through `SUPATERM_SURFACE_ID`.
- No workspace-specific socket methods are exposed in v1.

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
- The socket file is created with `0600` permissions after a successful bind.
- If the path already contains a socket node, the runtime removes it and reuses the path.
- If the path is occupied by a non-socket file, startup fails.
- Requests are newline-delimited JSON messages.
- Replies are newline-delimited JSON responses.
- If the reducer has not started consuming the request stream yet, the runtime buffers requests until `requests()` is observed.

## Code Map

- App startup: `apps/mac/supaterm/App/supatermApp.swift`
- Socket feature semantics: `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift`
- Dependency boundary: `apps/mac/supaterm/Features/Socket/SocketControlClient.swift`
- Unix socket transport: `apps/mac/supaterm/Features/Socket/SocketControlRuntime.swift`
- Socket target resolution: `apps/mac/supaterm/Features/Socket/SupatermDebugSnapshotResolver.swift`
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
