import ComposableArchitecture
import SwiftUI

@main
@MainActor
struct SupatermApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  @State private var ghostty: GhosttyRuntime
  @State private var ghosttyShortcuts: GhosttyShortcutManager
  @State private var terminal: TerminalHostState
  @State private var store: StoreOf<AppFeature>

  @MainActor init() {
    GhosttyBootstrap.initialize()
    let runtime = GhosttyRuntime()
    let terminal = TerminalHostState(runtime: runtime)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    } withDependencies: {
      $0.terminalClient = .live(host: terminal)
    }
    QuitRequestBridge.shared.onQuitRequested = { windowID in
      store.send(.quitRequested(windowID))
    }
    _ghostty = State(initialValue: runtime)
    _ghosttyShortcuts = State(initialValue: GhosttyShortcutManager(runtime: runtime))
    _terminal = State(initialValue: terminal)
    _store = State(initialValue: store)
  }

  var body: some Scene {
    Window("Supaterm", id: "main") {
      GhosttyColorSchemeSyncView(ghostty: ghostty) {
        ContentView(store: store, terminal: terminal)
      }
    }
    .defaultSize(width: 1_440, height: 900)
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentMinSize)
    .commands {
      TerminalCommands(store: store, ghosttyShortcuts: ghosttyShortcuts)
    }
  }
}
