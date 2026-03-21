enum SupatermCommand: Hashable, Sendable {
  enum SearchDirection: Hashable, Sendable {
    case next
    case previous
  }

  enum SplitDirection: Hashable, Sendable {
    case down
    case left
    case right
    case top
  }

  case closeAllWindows
  case closeSurface
  case closeTab
  case closeWindow
  case endSearch
  case equalizeSplits
  case goToTab(Int)
  case lastTab
  case navigateSearch(SearchDirection)
  case newSplit(SplitDirection)
  case newTab
  case newWindow
  case nextTab
  case previousTab
  case searchSelection
  case startSearch
  case toggleSplitZoom

  var ghosttyBindingAction: String {
    switch self {
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
    case .newSplit(.top):
      "new_split:up"
    case .newTab:
      "new_tab"
    case .newWindow:
      "new_window"
    case .nextTab:
      "next_tab"
    case .previousTab:
      "previous_tab"
    case .searchSelection:
      "search_selection"
    case .startSearch:
      "start_search"
    case .toggleSplitZoom:
      "toggle_split_zoom"
    }
  }
}
