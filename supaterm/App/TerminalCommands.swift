import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalCommands: Commands {
  let store: StoreOf<UpdateFeature>

  var body: some Commands {
    let isDevelopmentBuild: Bool = {
      #if DEBUG
        return true
      #else
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SupatermDevelopmentBuild") else {
          return false
        }
        switch value {
        case let boolValue as Bool:
          return boolValue
        case let stringValue as String:
          ["1", "true", "yes"].contains(stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        default:
          return false
        }
      #endif
    }()

    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }

    CommandGroup(after: .appInfo) {
      if isDevelopmentBuild {
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
