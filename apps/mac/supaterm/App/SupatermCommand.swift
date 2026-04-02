import SwiftUI

enum SupatermCommand: Hashable, Sendable {
  enum SplitFocusDirection: Hashable, Sendable {
    case down
    case left
    case next
    case previous
    case right
    case up
  }

  enum SplitResizeDirection: Hashable, Sendable {
    case down
    case left
    case right
    case up
  }

  enum SearchDirection: Hashable, Sendable {
    case next
    case previous
  }

  enum SplitDirection: Hashable, Sendable {
    case down
    case left
    case right
    case up
  }

  case copyToClipboard
  case closeAllWindows
  case closeSurface
  case closeTab
  case closeWindow
  case endSearch
  case equalizeSplits
  case goToTab(Int)
  case goToSplit(SplitFocusDirection)
  case lastTab
  case navigateSearch(SearchDirection)
  case newSplit(SplitDirection)
  case newTab
  case newWindow
  case nextTab
  case pasteFromClipboard
  case pasteFromSelection
  case previousTab
  case promptSurfaceTitle
  case promptTabTitle
  case resizeSplit(SplitResizeDirection, UInt16)
  case searchSelection
  case selectAll
  case startSearch
  case toggleSplitZoom

  var ghosttyBindingAction: String {
    switch self {
    case .copyToClipboard:
      "copy_to_clipboard"
    case .closeAllWindows:
      "close_all_windows"
    case .closeSurface:
      "close_surface"
    case .closeTab:
      "close_tab"
    case .closeWindow:
      "close_window"
    case .endSearch:
      "end_search"
    case .equalizeSplits:
      "equalize_splits"
    case .goToTab(let tab):
      "goto_tab:\(tab)"
    case .goToSplit(.down):
      "goto_split:down"
    case .goToSplit(.left):
      "goto_split:left"
    case .goToSplit(.next):
      "goto_split:next"
    case .goToSplit(.previous):
      "goto_split:previous"
    case .goToSplit(.right):
      "goto_split:right"
    case .goToSplit(.up):
      "goto_split:up"
    case .lastTab:
      "last_tab"
    case .navigateSearch(.next):
      "navigate_search:next"
    case .navigateSearch(.previous):
      "navigate_search:previous"
    case .newSplit(.down):
      "new_split:down"
    case .newSplit(.left):
      "new_split:left"
    case .newSplit(.right):
      "new_split:right"
    case .newSplit(.up):
      "new_split:up"
    case .newTab:
      "new_tab"
    case .newWindow:
      "new_window"
    case .nextTab:
      "next_tab"
    case .pasteFromClipboard:
      "paste_from_clipboard"
    case .pasteFromSelection:
      "paste_from_selection"
    case .previousTab:
      "previous_tab"
    case .promptSurfaceTitle:
      "prompt_surface_title"
    case .promptTabTitle:
      "prompt_tab_title"
    case .resizeSplit(.down, let amount):
      "resize_split:down,\(amount)"
    case .resizeSplit(.left, let amount):
      "resize_split:left,\(amount)"
    case .resizeSplit(.right, let amount):
      "resize_split:right,\(amount)"
    case .resizeSplit(.up, let amount):
      "resize_split:up,\(amount)"
    case .searchSelection:
      "search_selection"
    case .selectAll:
      "select_all"
    case .startSearch:
      "start_search"
    case .toggleSplitZoom:
      "toggle_split_zoom"
    }
  }

  var defaultKeyboardShortcut: KeyboardShortcut? {
    switch self {
    case .copyToClipboard:
      KeyboardShortcut("c", modifiers: .command)
    case .closeAllWindows:
      KeyboardShortcut("w", modifiers: [.command, .option, .shift])
    case .closeSurface:
      KeyboardShortcut("w", modifiers: .command)
    case .closeTab:
      KeyboardShortcut("w", modifiers: [.command, .option])
    case .closeWindow:
      KeyboardShortcut("w", modifiers: [.command, .shift])
    case .endSearch:
      KeyboardShortcut(.escape, modifiers: [])
    case .equalizeSplits:
      KeyboardShortcut("=", modifiers: [.command, .control])
    case .goToTab(let tab) where (1...10).contains(tab):
      KeyboardShortcut(tabKeyEquivalent(tab), modifiers: .command)
    case .navigateSearch(.next):
      KeyboardShortcut("g", modifiers: .command)
    case .navigateSearch(.previous):
      KeyboardShortcut("g", modifiers: [.command, .shift])
    case .newSplit(.down):
      KeyboardShortcut("d", modifiers: [.command, .shift])
    case .newSplit(.right):
      KeyboardShortcut("d", modifiers: .command)
    case .newTab:
      KeyboardShortcut("t", modifiers: .command)
    case .newWindow:
      KeyboardShortcut("n", modifiers: .command)
    case .nextTab:
      KeyboardShortcut("]", modifiers: [.command, .shift])
    case .pasteFromClipboard:
      KeyboardShortcut("v", modifiers: .command)
    case .pasteFromSelection:
      KeyboardShortcut("v", modifiers: [.command, .shift])
    case .previousTab:
      KeyboardShortcut("[", modifiers: [.command, .shift])
    case .searchSelection:
      KeyboardShortcut("e", modifiers: .command)
    case .selectAll:
      KeyboardShortcut("a", modifiers: .command)
    case .startSearch:
      KeyboardShortcut("f", modifiers: .command)
    case .toggleSplitZoom:
      KeyboardShortcut(.return, modifiers: [.command, .shift])
    case .goToSplit,
      .lastTab,
      .goToTab,
      .newSplit(.left),
      .newSplit(.up),
      .promptSurfaceTitle,
      .promptTabTitle,
      .resizeSplit:
      nil
    }
  }

  private func tabKeyEquivalent(_ tab: Int) -> KeyEquivalent {
    if tab == 10 {
      return KeyEquivalent("0")
    }
    return KeyEquivalent(Character(String(tab)))
  }
}
