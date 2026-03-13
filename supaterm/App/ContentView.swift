import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>

  var body: some View {
    TerminalView(store: store)
      .task {
        store.send(.update(.task))
      }
  }
}
