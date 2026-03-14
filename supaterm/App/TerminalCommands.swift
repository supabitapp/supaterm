import AppKit
import ComposableArchitecture
import SwiftUI

struct TerminalCommands: Commands {
  let store: StoreOf<AppFeature>
  let terminal: TerminalHostState

  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        NotificationCenter.default.post(name: .toggleSidebar, object: nil)
      }
      .keyboardShortcut("s", modifiers: .command)
    }

    CommandMenu("Tabs") {
      Button("New Tab") {
        _ = terminal.createTab()
      }
      .keyboardShortcut(AppShortcuts.newTab.keyEquivalent, modifiers: AppShortcuts.newTab.modifiers)

      Button("Close Tab") {
        _ = terminal.requestCloseSelectedTab()
      }
      .keyboardShortcut(
        AppShortcuts.closeTab.keyEquivalent,
        modifiers: AppShortcuts.closeTab.modifiers
      )

      Divider()

      Button("Next Tab") {
        terminal.nextTab()
      }
      .keyboardShortcut(AppShortcuts.nextTab.keyEquivalent, modifiers: AppShortcuts.nextTab.modifiers)

      Button("Previous Tab") {
        terminal.previousTab()
      }
      .keyboardShortcut(
        AppShortcuts.previousTab.keyEquivalent,
        modifiers: AppShortcuts.previousTab.modifiers
      )

      Divider()

      ForEach(1...10, id: \.self) { slot in
        Button("Tab \(slot)") {
          terminal.selectTab(slot: slot)
        }
        .keyboardShortcut(
          KeyEquivalent(slot == 10 ? "0" : Character("\(slot)")),
          modifiers: .command
        )
      }
    }

    CommandMenu("Pane") {
      Button("Split Below") {
        _ = terminal.performBindingActionOnFocusedSurface("new_split:down")
      }

      Button("Split Right") {
        _ = terminal.performBindingActionOnFocusedSurface("new_split:right")
      }

      Divider()

      Button("Equalize Panes") {
        _ = terminal.performBindingActionOnFocusedSurface("equalize_splits")
      }

      Button("Toggle Pane Zoom") {
        _ = terminal.performBindingActionOnFocusedSurface("toggle_split_zoom")
      }
    }

    CommandGroup(after: .textEditing) {
      Button("Find...") {
        _ = terminal.startSearch()
      }
      .keyboardShortcut("f", modifiers: .command)

      Button("Find Next") {
        _ = terminal.navigateSearchNext()
      }
      .keyboardShortcut("g", modifiers: .command)

      Button("Find Previous") {
        _ = terminal.navigateSearchPrevious()
      }
      .keyboardShortcut("g", modifiers: [.command, .shift])

      Divider()

      Button("Hide Find Bar") {
        _ = terminal.endSearch()
      }
      .keyboardShortcut(.escape, modifiers: [])

      Divider()

      Button("Use Selection for Find") {
        _ = terminal.searchSelection()
      }
      .keyboardShortcut("e", modifiers: .command)
    }

    CommandGroup(after: .appInfo) {
      Button("Check for Updates...") {
        store.send(.update(.checkForUpdatesButtonTapped))
      }
      .disabled(!store.update.canCheckForUpdates)
    }
  }
}
