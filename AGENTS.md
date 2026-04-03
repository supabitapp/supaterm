## Issue tracking

- Issues are tracked on: https://linear.app/supaterm

Example command of getting issues using linear-cli

```
linear issue list --team SUP --sort manual --limit 50 --no-pager
```

## Layout

- `apps/mac` — macOS app, CLI, Tuist project, resources, and the Ghostty dependency
- `apps/supaterm.com` — Marketing website (Vite+, Cloudflare Workers)

## Documentation

- `./docs/development.md` - general developmetn doc
- `./docs/coding-agents-integration.md` - how coding agents integration features work
- `./docs/how-socket-works.md` - how the sp cli and the macOS app talk through socket IPC
- Read `apps/supaterm.com/AGENTS.md` before working in the web app

### Commands

```bash
make mac-check          # format + lint
make mac-build          # Debug build
make mac-run            # Debug build + launch
make mac-test           # full test suite
```

Run a single test class or method:
```bash
xcodebuild test -workspace apps/mac/supaterm.xcworkspace -scheme supaterm -destination "platform=macOS" \
  -only-testing:supatermTests/AppFeatureTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation
```

### Website (`apps/supaterm.com`)

```bash
make web-install        # install dependencies (vp install)
make web-check          # format + lint + type check
make web-dev            # dev server
make web-test           # test suite
make web-build          # production build
```


## Some rules

- When logic changes in a Reducer, always add tests

## Terminology

- Spaces are the top-level container in a window
- Tabs belong to spaces and can be pinned
- Panes belong to tabs, and a tab can have multiple panes

## macOS App Architecture

The app uses The Composable Architecture (TCA) with a feature-based folder structure under `apps/mac/supaterm/`:

- `App/` — App entry point (`main.swift` + `AppDelegate`), `TerminalWindowController`, `ContentView`, `SupatermMenuController`, `GhosttyBootstrap`
- `Features/App/` — Root `AppFeature` reducer: composes child features, manages terminal tab selection and quit flow
- `Features/Terminal/` — Core terminal UI: sidebar, detail pane, split tree, tab catalog, and space management. `TerminalWindowFeature` is the main reducer; `TerminalHostState` owns the Ghostty runtime and surface views per window
- `Features/Update/` — `UpdateFeature` reducer + `UpdateClient` wrapping Sparkle (SPU). Lifecycle modeled as `UpdatePhase` enum
- `Features/Socket/` — Unix domain socket server for the `sp` CLI. `SocketControlFeature` dispatches JSON-RPC-style requests (`app.debug`, `app.tree`, `system.ping`, `terminal.new_pane`)
- `Features/Chrome/` — AppKit/SwiftUI bridge utilities (blur effects, mouse tracking, window reader)
