import ComposableArchitecture
import SwiftUI

@main
@MainActor
struct SupatermApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  @State private var terminalWindowRegistry: TerminalWindowRegistry
  @State private var socketStore: StoreOf<SocketControlFeature>

  @MainActor init() {
    GhosttyBootstrap.initialize()
    let terminalWindowRegistry = TerminalWindowRegistry()
    let socketStore = Store(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.terminalWindowsClient = .live(registry: terminalWindowRegistry)
    }
    _terminalWindowRegistry = State(initialValue: terminalWindowRegistry)
    _socketStore = State(initialValue: socketStore)
    appDelegate.onQuitRequested = { window in
      terminalWindowRegistry.requestQuit(for: window)
    }
    Task { @MainActor [socketStore] in
      socketStore.send(.task)
    }
  }

  var body: some Scene {
    WindowGroup("Supaterm") {
      WindowSceneRootView(registry: terminalWindowRegistry)
    }
    .defaultSize(width: 1_440, height: 900)
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentMinSize)
    .commands {
      TerminalCommands(registry: terminalWindowRegistry)
    }
  }
}
