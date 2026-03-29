import SwiftUI

struct TerminalCommands: Commands {
  let registry: TerminalWindowRegistry

  var body: some Commands {
    let snapshot = registry.terminalCommandSnapshot()
    let shortcut: (String) -> KeyboardShortcut? = { action in
      snapshot.keyboardShortcutProvider(action)
    }

    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        snapshot.toggleSidebar?()
      }
      .keyboardShortcut("s", modifiers: .command)
      .disabled(snapshot.toggleSidebar == nil)
    }

    CommandGroup(after: .newItem) {
      Button("New Tab") {
        snapshot.newTerminal?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("new_tab")))
      .disabled(snapshot.newTerminal == nil)

      Button("Close") {
        snapshot.closeSurface?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("close_surface")))
      .disabled(snapshot.closeSurface == nil)

      Button("Close Tab") {
        snapshot.closeTab?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("close_tab")))
      .disabled(snapshot.closeTab == nil)
    }

    CommandMenu("Tabs") {
      Button("Next Tab") {
        snapshot.nextTab?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("next_tab")))
      .disabled(snapshot.nextTab == nil)

      Button("Previous Tab") {
        snapshot.previousTab?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("previous_tab")))
      .disabled(snapshot.previousTab == nil)

      Divider()

      ForEach(1...8, id: \.self) { slot in
        Button("Tab \(slot)") {
          snapshot.selectTab?(slot)
        }
        .modifier(
          KeyboardShortcutModifier(shortcut: shortcut("goto_tab:\(slot)"))
        )
        .disabled(snapshot.selectTab == nil)
      }

      Button("Last Tab") {
        snapshot.selectLastTab?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("last_tab")))
      .disabled(snapshot.selectLastTab == nil)
    }

    CommandMenu("Spaces") {
      ForEach(1...9, id: \.self) { slot in
        Button("Space \(slot)") {
          snapshot.selectWorkspace?(slot)
        }
        .keyboardShortcut(KeyEquivalent(Character(String(slot))), modifiers: .control)
        .disabled(snapshot.selectWorkspace == nil)
      }

      Button("Space 10") {
        snapshot.selectWorkspace?(0)
      }
      .keyboardShortcut("0", modifiers: .control)
      .disabled(snapshot.selectWorkspace == nil)
    }

    CommandMenu("Pane") {
      Button("Split Below") {
        snapshot.splitBelow?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("new_split:down")))
      .disabled(snapshot.splitBelow == nil)

      Button("Split Right") {
        snapshot.splitRight?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("new_split:right")))
      .disabled(snapshot.splitRight == nil)

      Divider()

      Button("Equalize Panes") {
        snapshot.equalizePanes?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("equalize_splits")))
      .disabled(snapshot.equalizePanes == nil)

      Button("Toggle Pane Zoom") {
        snapshot.togglePaneZoom?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("toggle_split_zoom")))
      .disabled(snapshot.togglePaneZoom == nil)
    }

    CommandGroup(after: .textEditing) {
      Button("Find...") {
        snapshot.startSearch?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("start_search")))
      .disabled(snapshot.startSearch == nil)

      Button("Find Next") {
        snapshot.navigateSearchNext?()
      }
      .modifier(
        KeyboardShortcutModifier(
          shortcut: shortcut(GhosttySearchDirection.next.bindingAction)
        )
      )
      .disabled(snapshot.navigateSearchNext == nil)

      Button("Find Previous") {
        snapshot.navigateSearchPrevious?()
      }
      .modifier(
        KeyboardShortcutModifier(
          shortcut: shortcut(GhosttySearchDirection.previous.bindingAction)
        )
      )
      .disabled(snapshot.navigateSearchPrevious == nil)

      Divider()

      Button("Hide Find Bar") {
        snapshot.endSearch?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("end_search")))
      .disabled(snapshot.endSearch == nil)

      Divider()

      Button("Use Selection for Find") {
        snapshot.searchSelection?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut("search_selection")))
      .disabled(snapshot.searchSelection == nil)
    }

    CommandGroup(after: .appInfo) {
      Button(snapshot.updateMenuItemText) {
        snapshot.checkForUpdates?()
      }
      .disabled(snapshot.checkForUpdates == nil)
    }
  }
}

struct TerminalCommandSnapshot {
  let newTerminal: (() -> Void)?
  let closeSurface: (() -> Void)?
  let closeTab: (() -> Void)?
  let nextTab: (() -> Void)?
  let previousTab: (() -> Void)?
  let selectTab: ((Int) -> Void)?
  let selectLastTab: (() -> Void)?
  let selectWorkspace: ((Int) -> Void)?
  let toggleSidebar: (() -> Void)?
  let startSearch: (() -> Void)?
  let searchSelection: (() -> Void)?
  let navigateSearchNext: (() -> Void)?
  let navigateSearchPrevious: (() -> Void)?
  let endSearch: (() -> Void)?
  let splitBelow: (() -> Void)?
  let splitRight: (() -> Void)?
  let equalizePanes: (() -> Void)?
  let togglePaneZoom: (() -> Void)?
  let checkForUpdates: (() -> Void)?
  let updateMenuItemText: String
  let keyboardShortcutProvider: (String) -> KeyboardShortcut?

  static let empty = Self(
    newTerminal: nil,
    closeSurface: nil,
    closeTab: nil,
    nextTab: nil,
    previousTab: nil,
    selectTab: nil,
    selectLastTab: nil,
    selectWorkspace: nil,
    toggleSidebar: nil,
    startSearch: nil,
    searchSelection: nil,
    navigateSearchNext: nil,
    navigateSearchPrevious: nil,
    endSearch: nil,
    splitBelow: nil,
    splitRight: nil,
    equalizePanes: nil,
    togglePaneZoom: nil,
    checkForUpdates: nil,
    updateMenuItemText: "Check for Updates...",
    keyboardShortcutProvider: { _ in nil }
  )
}

private struct KeyboardShortcutModifier: ViewModifier {
  let shortcut: KeyboardShortcut?

  func body(content: Content) -> some View {
    if let shortcut {
      content.keyboardShortcut(shortcut)
    } else {
      content
    }
  }
}
