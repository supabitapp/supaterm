import SwiftUI

struct TerminalCommands: Commands {
  @FocusedValue(\.nextTabAction) private var nextTabAction
  @FocusedValue(\.previousTabAction) private var previousTabAction
  @FocusedValue(\.selectTabAction) private var selectTabAction
  @FocusedValue(\.selectLastTabAction) private var selectLastTabAction
  @FocusedValue(\.selectWorkspaceAction) private var selectWorkspaceAction
  @FocusedValue(\.toggleSidebarAction) private var toggleSidebarAction
  @FocusedValue(\.startSearchAction) private var startSearchAction
  @FocusedValue(\.searchSelectionAction) private var searchSelectionAction
  @FocusedValue(\.navigateSearchNextAction) private var navigateSearchNextAction
  @FocusedValue(\.navigateSearchPreviousAction) private var navigateSearchPreviousAction
  @FocusedValue(\.endSearchAction) private var endSearchAction
  @FocusedValue(\.splitBelowAction) private var splitBelowAction
  @FocusedValue(\.splitRightAction) private var splitRightAction
  @FocusedValue(\.equalizePanesAction) private var equalizePanesAction
  @FocusedValue(\.togglePaneZoomAction) private var togglePaneZoomAction
  @FocusedValue(\.checkForUpdatesAction) private var checkForUpdatesAction
  @FocusedValue(\.updatePhase) private var updatePhase
  @FocusedValue(\.ghosttyKeyboardShortcutProvider) private var ghosttyKeyboardShortcutProvider

  var body: some Commands {
    CommandGroup(replacing: .sidebar) {
      Button("Toggle Sidebar") {
        toggleSidebarAction?()
      }
      .keyboardShortcut("s", modifiers: .command)
      .disabled(toggleSidebarAction == nil)
    }

    CommandMenu("Tabs") {
      Button("Next Tab") {
        nextTabAction?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut(for: "next_tab")))
      .disabled(nextTabAction == nil)

      Button("Previous Tab") {
        previousTabAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "previous_tab"))
      )
      .disabled(previousTabAction == nil)

      Divider()

      ForEach(1...8, id: \.self) { slot in
        Button("Tab \(slot)") {
          selectTabAction?(slot)
        }
        .modifier(
          KeyboardShortcutModifier(shortcut: shortcut(for: "goto_tab:\(slot)"))
        )
        .disabled(selectTabAction == nil)
      }

      Button("Last Tab") {
        selectLastTabAction?()
      }
      .modifier(KeyboardShortcutModifier(shortcut: shortcut(for: "last_tab")))
      .disabled(selectLastTabAction == nil)
    }

    CommandMenu("Spaces") {
      ForEach(1...9, id: \.self) { slot in
        Button("Space \(slot)") {
          selectWorkspaceAction?(slot)
        }
        .keyboardShortcut(KeyEquivalent(Character(String(slot))), modifiers: .control)
        .disabled(selectWorkspaceAction == nil)
      }

      Button("Space 10") {
        selectWorkspaceAction?(0)
      }
      .keyboardShortcut("0", modifiers: .control)
      .disabled(selectWorkspaceAction == nil)
    }

    CommandMenu("Pane") {
      Button("Split Below") {
        splitBelowAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "new_split:down"))
      )
      .disabled(splitBelowAction == nil)

      Button("Split Right") {
        splitRightAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "new_split:right"))
      )
      .disabled(splitRightAction == nil)

      Divider()

      Button("Equalize Panes") {
        equalizePanesAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "equalize_splits"))
      )
      .disabled(equalizePanesAction == nil)

      Button("Toggle Pane Zoom") {
        togglePaneZoomAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "toggle_split_zoom"))
      )
      .disabled(togglePaneZoomAction == nil)
    }

    CommandGroup(after: .textEditing) {
      Button("Find...") {
        startSearchAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "start_search"))
      )
      .disabled(startSearchAction == nil)

      Button("Find Next") {
        navigateSearchNextAction?()
      }
      .modifier(
        KeyboardShortcutModifier(
          shortcut: shortcut(
            for: GhosttySearchDirection.next.bindingAction
          )
        )
      )
      .disabled(navigateSearchNextAction == nil)

      Button("Find Previous") {
        navigateSearchPreviousAction?()
      }
      .modifier(
        KeyboardShortcutModifier(
          shortcut: shortcut(
            for: GhosttySearchDirection.previous.bindingAction
          )
        )
      )
      .disabled(navigateSearchPreviousAction == nil)

      Divider()

      Button("Hide Find Bar") {
        endSearchAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "end_search"))
      )
      .disabled(endSearchAction == nil)

      Divider()

      Button("Use Selection for Find") {
        searchSelectionAction?()
      }
      .modifier(
        KeyboardShortcutModifier(shortcut: shortcut(for: "search_selection"))
      )
      .disabled(searchSelectionAction == nil)
    }

    CommandGroup(after: .appInfo) {
      Button(updatePhase?.menuItemText ?? "Check for Updates...") {
        checkForUpdatesAction?()
      }
      .disabled(checkForUpdatesAction == nil)
    }
  }

  private func shortcut(for action: String) -> KeyboardShortcut? {
    ghosttyKeyboardShortcutProvider?(action)
  }
}

private struct NextTabActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var nextTabAction: (() -> Void)? {
    get { self[NextTabActionKey.self] }
    set { self[NextTabActionKey.self] = newValue }
  }
}

private struct PreviousTabActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var previousTabAction: (() -> Void)? {
    get { self[PreviousTabActionKey.self] }
    set { self[PreviousTabActionKey.self] = newValue }
  }
}

private struct SelectTabActionKey: FocusedValueKey {
  typealias Value = (Int) -> Void
}

extension FocusedValues {
  var selectTabAction: ((Int) -> Void)? {
    get { self[SelectTabActionKey.self] }
    set { self[SelectTabActionKey.self] = newValue }
  }
}

private struct SelectLastTabActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var selectLastTabAction: (() -> Void)? {
    get { self[SelectLastTabActionKey.self] }
    set { self[SelectLastTabActionKey.self] = newValue }
  }
}

private struct SelectWorkspaceActionKey: FocusedValueKey {
  typealias Value = (Int) -> Void
}

extension FocusedValues {
  var selectWorkspaceAction: ((Int) -> Void)? {
    get { self[SelectWorkspaceActionKey.self] }
    set { self[SelectWorkspaceActionKey.self] = newValue }
  }
}

private struct ToggleSidebarActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var toggleSidebarAction: (() -> Void)? {
    get { self[ToggleSidebarActionKey.self] }
    set { self[ToggleSidebarActionKey.self] = newValue }
  }
}

private struct StartSearchActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var startSearchAction: (() -> Void)? {
    get { self[StartSearchActionKey.self] }
    set { self[StartSearchActionKey.self] = newValue }
  }
}

private struct SearchSelectionActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var searchSelectionAction: (() -> Void)? {
    get { self[SearchSelectionActionKey.self] }
    set { self[SearchSelectionActionKey.self] = newValue }
  }
}

private struct NavigateSearchNextActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var navigateSearchNextAction: (() -> Void)? {
    get { self[NavigateSearchNextActionKey.self] }
    set { self[NavigateSearchNextActionKey.self] = newValue }
  }
}

private struct NavigateSearchPreviousActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var navigateSearchPreviousAction: (() -> Void)? {
    get { self[NavigateSearchPreviousActionKey.self] }
    set { self[NavigateSearchPreviousActionKey.self] = newValue }
  }
}

private struct EndSearchActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var endSearchAction: (() -> Void)? {
    get { self[EndSearchActionKey.self] }
    set { self[EndSearchActionKey.self] = newValue }
  }
}

private struct SplitBelowActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var splitBelowAction: (() -> Void)? {
    get { self[SplitBelowActionKey.self] }
    set { self[SplitBelowActionKey.self] = newValue }
  }
}

private struct SplitRightActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var splitRightAction: (() -> Void)? {
    get { self[SplitRightActionKey.self] }
    set { self[SplitRightActionKey.self] = newValue }
  }
}

private struct EqualizePanesActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var equalizePanesAction: (() -> Void)? {
    get { self[EqualizePanesActionKey.self] }
    set { self[EqualizePanesActionKey.self] = newValue }
  }
}

private struct TogglePaneZoomActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var togglePaneZoomAction: (() -> Void)? {
    get { self[TogglePaneZoomActionKey.self] }
    set { self[TogglePaneZoomActionKey.self] = newValue }
  }
}

private struct CheckForUpdatesActionKey: FocusedValueKey {
  typealias Value = () -> Void
}

extension FocusedValues {
  var checkForUpdatesAction: (() -> Void)? {
    get { self[CheckForUpdatesActionKey.self] }
    set { self[CheckForUpdatesActionKey.self] = newValue }
  }
}

private struct GhosttyKeyboardShortcutProviderKey: FocusedValueKey {
  typealias Value = (String) -> KeyboardShortcut?
}

extension FocusedValues {
  var updatePhase: UpdatePhase? {
    get { self[UpdatePhaseKey.self] }
    set { self[UpdatePhaseKey.self] = newValue }
  }
}

private struct UpdatePhaseKey: FocusedValueKey {
  typealias Value = UpdatePhase
}

extension FocusedValues {
  var ghosttyKeyboardShortcutProvider: ((String) -> KeyboardShortcut?)? {
    get { self[GhosttyKeyboardShortcutProviderKey.self] }
    set { self[GhosttyKeyboardShortcutProviderKey.self] = newValue }
  }
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
