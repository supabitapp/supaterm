# Socket Control

This document is a code map. The source is authoritative.

## Flow

```text
SupatermApp
  |
  v
AppFeature
  |
  v
SocketControlFeature
  |
  v
SocketControlClient
  |
  v
SocketControlRuntime
  ^
  |
SPSocketClient
  ^
  |
sp ping

GhosttySurfaceView
  |
  v
SupatermCLIContext + SUPATERM_SOCKET_PATH
  |
  v
terminal pane
  |
  v
sp
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
