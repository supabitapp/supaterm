import ComposableArchitecture
import SwiftUI

@main
@MainActor
struct SupatermApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  @State private var terminal: TerminalHostState
  @State private var store: StoreOf<AppFeature>

  @MainActor init() {
    GhosttyBootstrap.initialize()
    _terminal = State(initialValue: TerminalHostState())
    _store = State(initialValue: Store(initialState: AppFeature.State()) { AppFeature() })
  }

  var body: some Scene {
    Window("Supaterm", id: "main") {
      GhosttyColorSchemeSyncView(applyColorScheme: terminal.setColorScheme(_:)) {
        ContentView(store: store, terminal: terminal)
      }
    }
    .defaultSize(width: 1_440, height: 900)
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentMinSize)
    .commands {
      TerminalCommands(store: store, terminal: terminal)
    }
  }
}
