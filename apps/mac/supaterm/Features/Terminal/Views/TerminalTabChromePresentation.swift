import Foundation

enum TerminalHorizontalTabTrailingStatus: Equatable {
  case progress(TerminalTabProgress)
  case attention
  case pinned
  case dirty

  var accessibilityDescription: String {
    switch self {
    case .progress(let progress):
      let state =
        switch progress.tone {
        case .active: "Progress"
        case .paused: "Progress paused"
        case .error: "Progress error"
        }
      guard let fraction = progress.fraction, fraction.isFinite else { return state }
      let percentage = Int((min(max(fraction, 0), 1) * 100).rounded())
      return "\(state), \(percentage) percent"
    case .attention:
      return "Needs attention"
    case .pinned:
      return "Pinned"
    case .dirty:
      return "Unsaved changes"
    }
  }
}

extension TerminalHostState.TabAgentStatus {
  var horizontalAccessibilityDescription: String {
    switch self {
    case .needsInput:
      return "Agent needs input"
    case .done:
      return "Agent done"
    case .working:
      return "Agent working"
    }
  }
}

struct TerminalTabChromePresentation: Equatable {
  static let empty = Self(panes: [], progress: nil)

  let panes: [TerminalTabPanePresentation]
  let progress: TerminalTabProgress?

  func horizontalTitle(for tab: TerminalTabItem) -> String {
    if tab.isTitleLocked {
      return tab.title
    }
    return panes.first(where: \.isFocused)?.title
      ?? panes.first?.title
      ?? tab.title
  }

  func horizontalAccessibilityTitle(for tab: TerminalTabItem) -> String {
    var titles = tab.isTitleLocked ? [tab.title] : []
    titles.append(contentsOf: panes.map(\.title))
    var seen = Set<String>()
    let uniqueTitles = titles.filter { seen.insert($0).inserted }
    return uniqueTitles.isEmpty ? tab.title : uniqueTitles.joined(separator: "/")
  }

  func horizontalTrailingStatus(
    for tab: TerminalTabItem,
    isPinned: Bool
  ) -> TerminalHorizontalTabTrailingStatus? {
    if let progress {
      return .progress(progress)
    }
    if panes.contains(where: { $0.indicator == .attention }) {
      return .attention
    }
    if isPinned {
      return .pinned
    }
    if tab.isDirty {
      return .dirty
    }
    return nil
  }

  var horizontalAgentStatus: TerminalHostState.TabAgentStatus? {
    panes.compactMap { pane in
      guard case .agent(let status) = pane.indicator else { return nil }
      return status
    }.max { lhs, rhs in
      TerminalHostState.tabAgentStatusPriority(lhs)
        < TerminalHostState.tabAgentStatusPriority(rhs)
    }
  }
}

struct TerminalHorizontalTabSurfacePresentation: Equatable {
  let tabsByID: [TerminalTabID: TerminalTabChromePresentation]
  let groupIconURLs: [TerminalTabGroupID: URL]
}

extension TerminalHostState {
  func tabChromePresentation(for tabID: TerminalTabID) -> TerminalTabChromePresentation {
    TerminalTabChromePresentation(
      panes: tabPanePresentations(for: tabID),
      progress: tabProgress(for: tabID)
    )
  }

  func tabChromePresentations(
    for snapshot: TerminalTabSurfaceSnapshot
  ) -> [TerminalTabID: TerminalTabChromePresentation] {
    Dictionary(
      uniqueKeysWithValues: snapshot.collection.tabs.map { tab in
        (tab.id, tabChromePresentation(for: tab.id))
      }
    )
  }

  func horizontalTabSurfacePresentation(
    for snapshot: TerminalTabSurfaceSnapshot,
    groupIconStore: TerminalTabGroupIconStore
  ) -> TerminalHorizontalTabSurfacePresentation {
    let iconRequests = tabGroupIconRequests(for: snapshot)
    return TerminalHorizontalTabSurfacePresentation(
      tabsByID: tabChromePresentations(for: snapshot),
      groupIconURLs: groupIconStore.iconURLs(for: iconRequests)
    )
  }
}
