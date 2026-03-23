import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  init(
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    self.store = store
    self._terminal = Bindable(terminal)
  }

  private var terminalStore: StoreOf<TerminalWindowFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    TerminalView(
      store: terminalStore,
      terminal: terminal
    )
    .task {
      store.send(.update(.task))
      terminalStore.send(.task)
    }
  }
}
