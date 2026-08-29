import ComposableArchitecture
import SwiftUI

@main
struct SupatermApp: App {
  private let store: StoreOf<AppFeature>

  init() {
    store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
  }

  var body: some Scene {
    WindowGroup {
      AppView(store: store)
    }
  }
}
