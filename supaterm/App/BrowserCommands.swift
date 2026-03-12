import AppKit
import SwiftUI

struct BrowserCommands: Commands {
  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }
  }
}
