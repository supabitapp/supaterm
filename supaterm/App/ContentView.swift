import AppKit
import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  let shareServerClient: ShareServerClient
  let ghosttyShortcuts: GhosttyShortcutManager
  let onWindowChanged: (NSWindow?) -> Void
  @Bindable var terminal: TerminalHostState
  @StateObject private var shareController: ShareServerStatusController

  init(
    store: StoreOf<AppFeature>,
    shareServerClient: ShareServerClient,
    terminal: TerminalHostState,
    ghosttyShortcuts: GhosttyShortcutManager,
    onWindowChanged: @escaping (NSWindow?) -> Void
  ) {
    self.store = store
    self.shareServerClient = shareServerClient
    self._terminal = Bindable(terminal)
    self.ghosttyShortcuts = ghosttyShortcuts
    self.onWindowChanged = onWindowChanged
    _shareController = StateObject(
      wrappedValue: ShareServerStatusController(shareServerClient: shareServerClient)
    )
  }

  private var terminalStore: StoreOf<TerminalSceneFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    TerminalView(
      store: terminalStore,
      shareController: shareController,
      terminal: terminal,
      onWindowChanged: onWindowChanged,
      updateStore: store.scope(state: \.update, action: \.update)
    )
    .task {
      shareController.startObservingIfNeeded()
      store.send(.update(.task))
      terminalStore.send(.task)
    }
  }
}
