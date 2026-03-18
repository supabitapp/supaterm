# Socket Control

This document is a short map of the socket path. The source is authoritative.

## Overview

- `SupatermApp` starts the socket feature when the app launches. See `supaterm/App/supatermApp.swift`.
- `SocketControlFeature` owns command semantics and turns decoded requests into responses. See `supaterm/Features/Socket/SocketControlFeature.swift`.
- `SocketControlRuntime` owns the Unix socket transport, including listening, accepting, decoding, and writing replies. See `supaterm/Features/Socket/SocketControlRuntime.swift`.
- `SupatermCLIShared` owns the shared contract between app and CLI: environment keys, socket path resolution, and request/response types. See `SupatermCLIShared/SupatermCLIContext.swift`, `SupatermCLIShared/SupatermSocketPath.swift`, and `SupatermCLIShared/SupatermSocketProtocol.swift`.
- `sp ping` resolves the socket path, sends a request through `SPSocketClient`, and prints the reducer's response. See `sp/main.swift` and `sp/SPSocketClient.swift`.
- Terminal panes receive the socket path and pane context through the environment. See `supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`.

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
| sp ping          | ---> | SPSocketClient   +------------------------+
+------------------+      +------------------+

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

## Code Map

- App startup: `supaterm/App/supatermApp.swift`
- Root reducer wiring: `supaterm/Features/App/AppFeature.swift`
- Socket feature semantics: `supaterm/Features/Socket/SocketControlFeature.swift`
- Dependency boundary: `supaterm/Features/Socket/SocketControlClient.swift`
- Unix socket transport: `supaterm/Features/Socket/SocketControlRuntime.swift`
- Shared path resolution: `SupatermCLIShared/SupatermSocketPath.swift`
- Shared protocol types: `SupatermCLIShared/SupatermSocketProtocol.swift`
- Pane environment contract: `SupatermCLIShared/SupatermCLIContext.swift`
- Pane environment injection: `supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift`
- CLI entrypoint: `sp/main.swift`
- CLI socket client: `sp/SPSocketClient.swift`

## Tests

- Reducer tests: `supatermTests/SocketControlFeatureTests.swift`
- Shared contract tests: `supatermTests/SupatermSocketProtocolTests.swift`
- Pane environment tests: `supatermTests/SupatermCLIContextTests.swift`
