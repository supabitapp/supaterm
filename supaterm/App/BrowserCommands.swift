import AppKit
import ComposableArchitecture
import SwiftUI

struct BrowserCommands: Commands {
  let store: StoreOf<UpdateFeature>

  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }

    CommandGroup(after: .appInfo) {
      Button("Check for Updates...") {
        store.send(.checkForUpdatesButtonTapped)
      }
      .disabled(!store.canCheckForUpdates)
    }
  }
}
