import ComposableArchitecture
import SwiftUI

@main
@MainActor
struct SupatermApp: App {
  static let mainWindowGroupID = "main"

  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @Environment(\.openWindow) private var openWindow

  @State private var menuController: SupatermMenuController
  @State private var terminalWindowRegistry: TerminalWindowRegistry
  @State private var socketStore: StoreOf<SocketControlFeature>

  @MainActor init() {
    GhosttyBootstrap.initialize()
    let terminalWindowRegistry = TerminalWindowRegistry()
    let menuController = SupatermMenuController(registry: terminalWindowRegistry)
    let socketStore = Store(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.terminalWindowsClient = .live(registry: terminalWindowRegistry)
    }
    _menuController = State(initialValue: menuController)
    _terminalWindowRegistry = State(initialValue: terminalWindowRegistry)
    _socketStore = State(initialValue: socketStore)
    appDelegate.menuController = menuController
    terminalWindowRegistry.onChange = { [weak menuController] in
      menuController?.refresh()
    }
    appDelegate.onQuitRequested = { window in
      terminalWindowRegistry.requestQuit(for: window)
    }
    Task { @MainActor [socketStore] in
      socketStore.send(.task)
    }
  }

  var body: some Scene {
    configureNewWindowAction()

    return WindowGroup("Supaterm", id: Self.mainWindowGroupID) {
      WindowSceneRootView(registry: terminalWindowRegistry)
    }
    .defaultSize(width: 1_440, height: 900)
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentMinSize)
  }

  private func configureNewWindowAction() {
    menuController.setNewWindowAction { [openWindow] in
      openWindow(id: Self.mainWindowGroupID)
      return true
    }
  }
}
