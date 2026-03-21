supaterm is a macOS terminal app tailored for coding agents, built on GhosttyKit for terminal emulation.

## Issue tracking

- Issues are tracked on: https://linear.app/supaterm

## Build Commands

First-time setup requires initializing the Ghostty submodule:
```bash
git submodule update --init --recursive
```

```bash
make check          # run both format and lint
make build-app      # build the macOS app (Debug)
make test           # run all tests
```

Run a single test class or method:
```bash
xcodebuild test -workspace supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

## Tooling

- **Tuist** manages project generation (`Project.swift`, `Tuist.swift`, `Tuist/Package.swift`)
- **mise** manages tool versions (`mise.toml`): tuist, swiftlint, xcbeautify
- **swift-format** for formatting, **swiftlint** for linting

## Code Guidelines

- Swift 6.2 with `SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor` and `SWIFT_APPROACHABLE_CONCURRENCY=YES`
- macOS 26.0+ deployment target, macOS-only app
- When a new logic changes in the Reducer, always add tests

## Architecture

The app uses **The Composable Architecture (TCA)** with a feature-based folder structure under `supaterm/`:

- `App/` — App entry point (`SupatermApp`), `ContentView`, `AppDelegate`, `TerminalCommands`, `GhosttyBootstrap`
- `Features/App/` — Root `AppFeature` reducer: composes child features, manages terminal tab selection and quit flow
- `Features/Terminal/` — Core terminal UI: sidebar, detail pane, split tree, tab catalog, workspace management. `TerminalSceneFeature` is the main reducer; `TerminalHostState` owns the Ghostty runtime and surface views per window
- `Features/Update/` — `UpdateFeature` reducer + `UpdateClient` dependency wrapping Sparkle (SPU) for in-app updates. Update lifecycle phases are modeled as an `UpdatePhase` enum
- `Features/Socket/` — Unix domain socket server for the `sp` CLI. `SocketControlFeature` starts the server and dispatches JSON-RPC-style requests (`app.debug`, `app.tree`, `system.ping`, `terminal.new_pane`)
- `Features/Chrome/` — AppKit/SwiftUI bridge utilities (blur effects, mouse tracking, window reader)

### Dependency pattern

External services are modeled as TCA `DependencyKey` structs with closure-based interfaces. Live implementations wrap platform SDK singletons (e.g., `UpdateRuntime`, `SocketControlRuntime`); test implementations return inert defaults — no mocking framework is used. Key clients: `TerminalClient`, `UpdateClient`, `SocketControlClient`, `AppTerminationClient`, `TerminalWindowsClient`.

### GhosttyKit integration

GhosttyKit is a pre-compiled C library from `ThirdParty/ghostty/` (git submodule), built via Zig into an XCFramework at `Frameworks/GhosttyKit.xcframework`. The Swift bridge lives in `Features/Terminal/Ghostty/`:

- `GhosttyBootstrap` — Sets resource/terminfo env vars and calls `ghostty_init()` at app launch
- `GhosttyRuntime` — App-level object calling `ghostty_app_new()` with C function pointer callbacks that marshal to `@MainActor`
- `GhosttySurfaceBridge` — Per-pane bridge owning a `ghostty_surface_t`; dispatches C actions into typed Swift handlers via closures back to `TerminalHostState`
- `GhosttySurfaceView` — `NSView` subclass for Metal-rendered terminal; bridges keyboard/mouse/resize events to `ghostty_surface_*` C calls

Data flow: `TerminalHostState` → creates `GhosttySurfaceView` → owns `GhosttySurfaceBridge` → calls back via closures → `TerminalHostState`

### `sp` CLI and socket IPC

The app embeds an `sp` CLI binary (target in `sp/`, built with ArgumentParser) inside the app bundle. The app injects `SUPATERM_SURFACE_ID`, `SUPATERM_TAB_ID`, and `SUPATERM_SOCKET_PATH` env vars into every shell pane, so `sp` commands work automatically from within a Supaterm terminal.

Shared protocol types live in `SupatermCLIShared/` (imported by both the app and CLI): `SupatermSocketRequest`, `SupatermSocketResponse`, `SupatermTreeSnapshot`, `SupatermAppDebugSnapshot`, etc. The CLI uses synchronous POSIX sockets (`SPSocketClient`).

### Persistence

Always use pointfree Sharing for persistence. Currently there is one persisted value: `TerminalWorkspaceCatalog` stored via `@Shared(.terminalWorkspaceCatalog)` using `FileStorageKey`. `TerminalHostState` observes catalog changes and applies diffs to the workspace manager; writes happen through `$workspaceCatalog.withLock { ... }`.

### Tests

Tests (`supatermTests/`) use Swift Testing (`@Test`, `@Suite`) with TCA's `TestStore`. Tests cover reducer logic; UI views are not snapshot-tested. Common patterns:

- **Command recorder**: Inject a spy via `$0.terminalClient.send = { recorder.record($0) }` to assert which commands a reducer sends
- **AsyncStream for events**: Use a captured continuation to push events mid-test and verify the reducer handles them with `await store.receive(\.clientEvent)`
- **State mutation assertions**: TCA's `store.send(.action) { $0.field = newValue }` closure syntax
