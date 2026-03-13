import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalCommands: Commands {
  let store: StoreOf<AppFeature>

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
          return ["1", "true", "yes"].contains(stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
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

    CommandMenu("Tabs") {
      Button("New Tab") {
        store.send(.tabs(.newTabButtonTapped))
      }
      .keyboardShortcut("t", modifiers: .command)

      Button("Close Tab") {
        store.send(.tabs(.closeButtonTapped(store.tabs.selectedTabID)))
      }
      .keyboardShortcut("w", modifiers: .command)

      Button("Pin Tab") {
        store.send(.tabs(.pinSelectedTabToggled))
      }
      .keyboardShortcut("d", modifiers: .command)

      Divider()

      Button("Next Tab") {
        store.send(.tabs(.nextTabRequested))
      }
      .keyboardShortcut("]", modifiers: [.command, .shift])

      Button("Previous Tab") {
        store.send(.tabs(.previousTabRequested))
      }
      .keyboardShortcut("[", modifiers: [.command, .shift])

      Divider()

      ForEach(1...10, id: \.self) { slot in
        Button("Tab \(slot)") {
          store.send(.tabs(.tabShortcutPressed(slot)))
        }
        .keyboardShortcut(KeyEquivalent(slot == 10 ? "0" : Character("\(slot)")), modifiers: .command)
      }
    }

    CommandGroup(after: .appInfo) {
      if isDevelopmentBuild {
        Button("This is a development build") {}
          .disabled(true)
      }

      Button("Check for Updates...") {
        store.send(.update(.checkForUpdatesButtonTapped))
      }
      .disabled(!store.update.canCheckForUpdates)
    }
  }
}
