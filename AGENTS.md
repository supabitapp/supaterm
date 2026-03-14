## Build Commands

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

- `App/` — App entry point (`SupatermApp`), `ContentView`, `AppDelegate`, `TerminalCommands`
- `Features/App/` — Root `AppFeature` reducer: composes child features, manages terminal tab selection
- `Features/Terminal/` — Terminal shell UI: sidebar, detail pane, split view, tab catalog, resize handles
- `Features/Update/` — `UpdateFeature` reducer + `UpdateClient` dependency wrapping Sparkle (SPU) for in-app updates

**Dependency pattern**: External services are modeled as TCA `DependencyKey` structs with closure-based interfaces (see `UpdateClient`). Live implementations wrap platform SDKs; test implementations return inert defaults.

**Tests** (`supatermTests/`) use Swift Testing (`@Test`, `@Suite`) with TCA's `TestStore`. Tests cover reducer logic; UI views are not snapshot-tested.
