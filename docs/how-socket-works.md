# Socket Control

This document captures the stable rules of Supaterm's socket IPC. The source remains authoritative for concrete APIs and current command surfaces.

## Model

- Each running Supaterm app process owns one Unix domain socket endpoint.
- The app and CLI share one protocol contract for discovery, requests, and responses.
- Pane-launched CLI processes are wired back to the owning app through injected environment, so the common path does not require discovery.
- CLI invocations outside Supaterm can discover managed endpoints, but they never guess when selection is ambiguous.

## Target Resolution

- An explicit socket target wins over every other signal.
- Ambient pane context wins over discovery.
- Discovery is a fallback for invocations that are not already inside a Supaterm pane.
- Managed socket discovery stays scoped to the current user.

## Request Handling

- Requests and replies are newline-delimited JSON messages.
- Transport concerns and command semantics are split cleanly.
- The transport layer owns socket lifecycle, buffering, and I/O.
- The app-side control layer interprets requests and produces typed responses.

## Terminal Topology

- Socket operations target the live terminal model exposed by the app.
- Explicit hierarchical targeting resolves in window, then space, then tab, then pane order.
- Pane-context targeting is available when the CLI is launched from inside Supaterm.

## Runtime Guarantees

- Managed socket paths are created in a per-user location with restrictive permissions.
- Stale managed sockets can be removed and replaced.
- Reachable sockets are never silently replaced.
- Path resolution is canonicalized so endpoint creation, discovery, and identity agree on the same location.
- Incoming requests can be buffered briefly until the app starts consuming the stream.

## Code Index

- `apps/mac/supaterm/Features/Socket/` is the app-side socket boundary.
- `apps/mac/supaterm/Features/Socket/SocketControlFeature.swift` owns request semantics.
- `apps/mac/supaterm/Features/Socket/SocketControlRuntime.swift` owns socket lifecycle and transport.
- `apps/mac/SupatermCLIShared/` holds the shared IPC contract.
- `apps/mac/SupatermCLIShared/SupatermSocketProtocol.swift` defines request and response types.
- `apps/mac/SupatermCLIShared/SupatermSocketPath.swift` defines endpoint resolution and discovery.
- `apps/mac/SupatermCLIShared/SupatermCLIContext.swift` defines pane context passed through environment.
- `apps/mac/SPCLI/` is the shared CLI implementation surface.
- `apps/mac/sp/main.swift` is the CLI entrypoint.
- `apps/mac/SPCLI/SPSocketClient.swift` is the CLI transport client.
- `apps/mac/supaterm/Features/Terminal/Ghostty/GhosttySurfaceView.swift` injects pane context into terminal processes.
