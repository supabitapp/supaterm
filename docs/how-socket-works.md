# Socket Control

This document is a current map of Supaterm's socket control path. The source is authoritative.

## Overview

- `SupatermApp` starts socket observation during app initialization by sending `.socket(.task)` to `AppFeature`. See `supaterm/App/supatermApp.swift`.
- `AppFeature` scopes `SocketControlFeature` into the root reducer state. See `supaterm/Features/App/AppFeature.swift`.
- `SocketControlFeature` owns socket command semantics. It starts the socket runtime through `SocketControlClient`, consumes streamed requests, maps them to terminal operations, and sends structured responses. See `supaterm/Features/Socket/SocketControlFeature.swift`.
- `SocketControlClient` is the dependency boundary between the reducer and the runtime. The live implementation delegates to `SocketControlRuntime.shared`. See `supaterm/Features/Socket/SocketControlClient.swift`.
- `SocketControlRuntime` owns the Unix domain socket transport: path resolution, directory creation, stale socket cleanup, `bind`, `listen`, `accept`, request decoding, buffering, and response writes. See `supaterm/Features/Socket/SocketControlRuntime.swift`.
- `TerminalClient` provides the app-side operations the socket feature can invoke today: tree snapshots and pane creation. See `supaterm/Features/Terminal/TerminalClient.swift`.
- `SupatermCLIShared` owns the shared contract between the app and CLI: environment keys, pane context parsing, socket path resolution, method names, and typed request/response payloads. See `SupatermCLIShared/SupatermCLIContext.swift`, `SupatermCLIShared/SupatermSocketPath.swift`, and `SupatermCLIShared/SupatermSocketProtocol.swift`.
- The `sp` CLI resolves the socket path, sends requests with `SPSocketClient`, and prints the reducer's response. Current socket-backed commands are `sp ping`, `sp tree`, and `sp new-pane`. See `sp/main.swift` and `sp/SPSocketClient.swift`.
- `GhosttySurfaceView` injects pane context and the resolved socket path into the terminal process environment. See `supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`.

## Environment

- `SUPATERM_SOCKET_PATH`: optional socket path override and pane-provided socket location
- `SUPATERM_SURFACE_ID`: current pane surface identifier
- `SUPATERM_TAB_ID`: current pane tab identifier

Definitions live in `SupatermCLIShared/SupatermCLIContext.swift`.

## Socket Path Resolution

- `SupatermSocketPath.resolve` prefers an explicit path first.
- If no explicit path is provided, it uses `SUPATERM_SOCKET_PATH` from the environment.
- If neither is set, it falls back to `Application Support/Supaterm/supaterm.sock`.

This logic is shared by the app runtime, the CLI, and pane-launched commands.

## Supported Methods

- `system.ping`: health check, returns `{"pong": true}`
- `app.tree`: returns a typed `SupatermTreeSnapshot` with a `window -> workspace -> tab -> pane` hierarchy
- `terminal.new_pane`: validates targeting rules, creates a pane through `TerminalClient`, and returns `SupatermNewPaneResult`

Method names and payload types live in `SupatermCLIShared/SupatermSocketProtocol.swift`.

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

## Pane Targeting

- `terminal.new_pane` is unchanged at the request and response level.
- Explicit `window` and `tab` targets are resolved within the currently selected workspace.
- Context-pane targeting still resolves globally through `SUPATERM_SURFACE_ID`.
- No workspace-specific socket methods are exposed in v1.

## Flow

```text
App side

+------------------+      +------------------------+      +----------------------+
| SupatermApp      | ---> | AppFeature             | ---> | SocketControlFeature |
+------------------+      +------------------------+      +-----------+----------+
                                                                     |
                                                                     v
                                                          +----------------------+
                                                          | SocketControlClient  |
                                                          +-----------+----------+
                                                                      |
                                                                      v
                                                          +----------------------+
                                                          | SocketControlRuntime |
                                                          +----------------------+
                                                                      ^
                                                                      |
CLI side                                                              |

+------------------+      +------------------+                        |
| sp ping/tree/    | ---> | SPSocketClient   +------------------------+
| new-pane         |      +------------------+
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

- App startup: `supaterm/App/supatermApp.swift`
- Root reducer wiring: `supaterm/Features/App/AppFeature.swift`
- Socket feature semantics: `supaterm/Features/Socket/SocketControlFeature.swift`
- Dependency boundary: `supaterm/Features/Socket/SocketControlClient.swift`
- Unix socket transport: `supaterm/Features/Socket/SocketControlRuntime.swift`
- Terminal operations exposed to the socket feature: `supaterm/Features/Terminal/TerminalClient.swift`
- Shared pane environment contract: `SupatermCLIShared/SupatermCLIContext.swift`
- Shared path resolution: `SupatermCLIShared/SupatermSocketPath.swift`
- Shared protocol types: `SupatermCLIShared/SupatermSocketProtocol.swift`
- Pane environment injection: `supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`
- CLI entrypoint: `sp/main.swift`
- CLI socket client: `sp/SPSocketClient.swift`

## Tests

- Reducer tests: `supatermTests/SocketControlFeatureTests.swift`
- Runtime tests: `supatermTests/SocketControlRuntimeTests.swift`
- Shared protocol and path tests: `supatermTests/SupatermSocketProtocolTests.swift`
- Pane environment contract tests: `supatermTests/SupatermCLIContextTests.swift`
