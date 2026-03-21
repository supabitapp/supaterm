import AppKit
import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  let onWindowChanged: (NSWindow?) -> Void
  @Bindable var terminal: TerminalHostState

  init(
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    onWindowChanged: @escaping (NSWindow?) -> Void
  ) {
    self.store = store
    self._terminal = Bindable(terminal)
    self.onWindowChanged = onWindowChanged
  }

  private var terminalStore: StoreOf<TerminalSceneFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    TerminalView(
      store: terminalStore,
      terminal: terminal,
      onWindowChanged: onWindowChanged,
      updateStore: store.scope(state: \.update, action: \.update)
    )
    .task {
      store.send(.update(.task))
      terminalStore.send(.task)
    }
  }
}
