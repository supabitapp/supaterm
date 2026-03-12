import ComposableArchitecture
import SwiftUI

@main
@MainActor
struct SupatermApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  private let store: StoreOf<AppFeature> = Store(initialState: AppFeature.State()) {
    AppFeature()
  }

  var body: some Scene {
    Window("Supaterm", id: "main") {
      ContentView(store: store)
    }
    .defaultSize(width: 1_440, height: 900)
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentMinSize)
    .commands {
      BrowserCommands()
    }
  }
}
