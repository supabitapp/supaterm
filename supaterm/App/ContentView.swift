import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  let terminal: TerminalHostState

  var body: some View {
    TerminalView(store: store, terminal: terminal)
      .task {
        store.send(.update(.task))
      }
  }
}
