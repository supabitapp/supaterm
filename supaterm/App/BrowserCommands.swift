import AppKit
import SwiftUI

struct BrowserCommands: Commands {
  let canCheckForUpdates: Bool
  let checkForUpdates: () -> Void

  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }

    CommandGroup(after: .appInfo) {
      Button("Check for Updates...") {
        checkForUpdates()
      }
      .disabled(!canCheckForUpdates)
    }
  }
}
