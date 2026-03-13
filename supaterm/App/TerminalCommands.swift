import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalCommands: Commands {
  let store: StoreOf<UpdateFeature>

  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }

    CommandGroup(after: .appInfo) {
      if AppBuild.isDevelopment {
        Button("This is a development build") {}
          .disabled(true)
      }

      Button("Check for Updates...") {
        store.send(.checkForUpdatesButtonTapped)
      }
      .disabled(!store.canCheckForUpdates)
    }
  }
}
