import AppKit
import Combine
import ComposableArchitecture
import SwiftUI

@MainActor
final class AppWindowController: ObservableObject {
  let objectWillChange = ObservableObjectPublisher()
  let sceneID = UUID()
  let ghostty: GhosttyRuntime
  let ghosttyShortcuts: GhosttyShortcutManager
  let terminal: TerminalHostState
  let store: StoreOf<AppFeature>

  private let registry: TerminalWindowRegistry

  init(registry: TerminalWindowRegistry) {
    self.registry = registry

    let ghostty = GhosttyRuntime()
    let terminal = TerminalHostState(runtime: ghostty)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
        ._printChanges(.actionLabels)
    } withDependencies: {
      $0.terminalClient = .live(host: terminal)
    }

    self.ghostty = ghostty
    self.ghosttyShortcuts = GhosttyShortcutManager(runtime: ghostty)
    self.terminal = terminal
    self.store = store

    registry.register(
      ghosttyShortcuts: ghosttyShortcuts,
      sceneID: sceneID,
      store: store,
      terminal: terminal
    )
  }

  deinit {
    let sceneID = self.sceneID
    let registry = self.registry
    Task { @MainActor in
      registry.unregister(sceneID: sceneID)
    }
  }

  func updateWindow(_ window: NSWindow?) {
    registry.updateWindowID(window.map(ObjectIdentifier.init), for: sceneID)
  }
}
