import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>

  var body: some View {
    BrowserChromeView(store: store)
  }
}
