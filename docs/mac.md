# macOS App

supaterm's current product is the macOS terminal app in `apps/mac`, built on GhosttyKit for terminal emulation.

## Issue tracking

- Issues are tracked on: https://linear.app/supaterm

## Build Commands

If your clone predates the monorepo move:
```bash
git submodule sync --recursive
git submodule update --init --recursive
```

From the repo root:

```bash
make mac-check
make mac-build
make mac-test
```

From `apps/mac`:

```bash
make check
make build-app
make test
```

Run a single test class or method:
```bash
xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

## Tooling

- Tuist manages project generation in `apps/mac/Project.swift`, `apps/mac/Tuist.swift`, and `apps/mac/Tuist/Package.swift`
- mise manages tool versions from the repo root `mise.toml`: tuist, swiftlint, xcbeautify
- swift-format for formatting, swiftlint for linting

## Code Guidelines

- Swift 6.2 with `SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor` and `SWIFT_APPROACHABLE_CONCURRENCY=YES`
- macOS 26.0+ deployment target, macOS-only app
- When a new logic changes in the Reducer, always add tests

## Architecture

The app uses The Composable Architecture with a feature-based folder structure under `apps/mac/supaterm/`:

- `App/` — App entry point (`main.swift` + `AppDelegate`), `TerminalWindowController`, `ContentView`, `SupatermMenuController`, `GhosttyBootstrap`
- `Features/App/` — Root `AppFeature` reducer: composes child features, manages terminal tab selection and quit flow
- `Features/Terminal/` — Core terminal UI: sidebar, detail pane, split tree, tab catalog, workspace management. `TerminalWindowFeature` is the main reducer; `TerminalHostState` owns the Ghostty runtime and surface views per window
- `Features/Update/` — `UpdateFeature` reducer + `UpdateClient` dependency wrapping Sparkle (SPU) for in-app updates. Update lifecycle phases are modeled as an `UpdatePhase` enum
- `Features/Socket/` — Unix domain socket server for the `sp` CLI. `SocketControlFeature` starts the server and dispatches JSON-RPC-style requests (`app.debug`, `app.tree`, `system.ping`, `terminal.new_pane`)
- `Features/Chrome/` — AppKit/SwiftUI bridge utilities (blur effects, mouse tracking, window reader)

### Dependency pattern

External services are modeled as TCA `DependencyKey` structs with closure-based interfaces. Live implementations wrap platform SDK singletons such as `UpdateRuntime` and `SocketControlRuntime`; test implementations return inert defaults. Key clients: `TerminalClient`, `UpdateClient`, `SocketControlClient`, `AppTerminationClient`, `TerminalWindowsClient`.

### GhosttyKit integration

GhosttyKit is built from `apps/mac/ThirdParty/ghostty/` through Tuist as a foreign-build target. The XCFramework is materialized at `apps/mac/Frameworks/GhosttyKit.xcframework`, and the app target copies Ghostty's generated `zig-out/share/ghostty` and `zig-out/share/terminfo` directories into the app bundle during the build. The Swift bridge lives in `apps/mac/supaterm/Features/Terminal/Ghostty/`:

- `GhosttyBootstrap` — Sets resource and terminfo environment variables and calls `ghostty_init()` at app launch
- `GhosttyRuntime` — App-level object calling `ghostty_app_new()` with C function pointer callbacks that marshal to `@MainActor`
- `GhosttySurfaceBridge` — Per-pane bridge owning a `ghostty_surface_t`; dispatches C actions into typed Swift handlers via closures back to `TerminalHostState`
- `GhosttySurfaceView` — `NSView` subclass for Metal-rendered terminal; bridges keyboard, mouse, and resize events to `ghostty_surface_*` C calls

Data flow: `TerminalHostState` → creates `GhosttySurfaceView` → owns `GhosttySurfaceBridge` → calls back via closures → `TerminalHostState`

### `sp` CLI and socket IPC

The app embeds an `sp` CLI binary from `apps/mac/sp/`, built with ArgumentParser, inside the app bundle. The app injects `SUPATERM_SURFACE_ID`, `SUPATERM_TAB_ID`, and `SUPATERM_SOCKET_PATH` environment variables into every shell pane, so `sp` commands work automatically from within a Supaterm terminal.

Shared protocol types live in `apps/mac/SupatermCLIShared/` and are imported by both the app and CLI: `SupatermSocketRequest`, `SupatermSocketResponse`, `SupatermTreeSnapshot`, `SupatermAppDebugSnapshot`, and related types. The CLI uses synchronous POSIX sockets through `SPSocketClient`.

### Persistence

Always use pointfree Sharing for persistence. Currently there is one persisted value: `TerminalWorkspaceCatalog` stored via `@Shared(.terminalWorkspaceCatalog)` using `FileStorageKey`. `TerminalHostState` observes catalog changes and applies diffs to the workspace manager; writes happen through `$workspaceCatalog.withLock { ... }`.

### Tests

Tests in `apps/mac/supatermTests/` use Swift Testing with TCA's `TestStore`. Tests cover reducer logic; UI views are not snapshot-tested. Common patterns:

- Command recorder: inject a spy via `$0.terminalClient.send = { recorder.record($0) }` to assert which commands a reducer sends
- AsyncStream for events: use a captured continuation to push events mid-test and verify the reducer handles them with `await store.receive(\.clientEvent)`
- State mutation assertions: use `store.send(.action) { $0.field = newValue }`
