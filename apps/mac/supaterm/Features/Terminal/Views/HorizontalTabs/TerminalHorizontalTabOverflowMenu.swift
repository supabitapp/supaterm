import AppKit

struct TerminalHorizontalTabOverflowModel: Equatable {
  struct Group: Equatable {
    let id: TerminalTabGroupID
    let title: String
    let isPinned: Bool
    let isCollapsed: Bool
    let headerIsHidden: Bool
    let tabs: [Tab]
  }

  enum Item: Equatable {
    case group(Group)
    case tab(Tab)

    var isPinned: Bool {
      switch self {
      case .group(let group): group.isPinned
      case .tab(let tab): tab.isPinned
      }
    }
  }

  struct Tab: Equatable {
    let id: TerminalTabID
    let title: String
    let isPinned: Bool
    let selection: SelectableRowSelection
  }

  let items: [Item]

  init(
    snapshot: TerminalTabSurfaceSnapshot,
    hiddenEntryIDs: Set<TerminalSidebarEntryID>,
    presentations: [TerminalSidebarEntryID: TerminalHorizontalTabItemPresentation],
    selectionState: TerminalTabSelectionState? = nil
  ) {
    let selectedTabID = snapshot.collection.selectedTabID
    items = snapshot.collection.rootItems.compactMap { root in
      switch root {
      case .tab(let item):
        guard hiddenEntryIDs.contains(.tab(item.tab.id)) else { return nil }
        return .tab(
          Tab(
            id: item.tab.id,
            title: Self.title(
              for: .tab(item.tab.id),
              fallback: item.tab.title,
              presentations: presentations
            ),
            isPinned: item.isPinned,
            selection: Self.selection(
              for: item.tab.id,
              selectedTabID: selectedTabID,
              selectionState: selectionState
            )
          )
        )
      case .group(let group):
        let headerIsHidden = hiddenEntryIDs.contains(.group(group.id))
        let tabs = group.tabs.compactMap { tab -> Tab? in
          guard headerIsHidden || hiddenEntryIDs.contains(.tab(tab.id)) else { return nil }
          return Tab(
            id: tab.id,
            title: Self.title(
              for: .tab(tab.id),
              fallback: tab.title,
              presentations: presentations
            ),
            isPinned: group.isPinned,
            selection: Self.selection(
              for: tab.id,
              selectedTabID: selectedTabID,
              selectionState: selectionState
            )
          )
        }
        guard headerIsHidden || !tabs.isEmpty else { return nil }
        return .group(
          Group(
            id: group.id,
            title: group.title,
            isPinned: group.isPinned,
            isCollapsed: snapshot.collapsedGroupIDs.contains(group.id),
            headerIsHidden: headerIsHidden,
            tabs: tabs
          )
        )
      }
    }
  }

  private static func title(
    for entryID: TerminalSidebarEntryID,
    fallback: String,
    presentations: [TerminalSidebarEntryID: TerminalHorizontalTabItemPresentation]
  ) -> String {
    guard let presentation = presentations[entryID] else { return fallback }
    switch presentation.content {
    case .group(_, let title, _, _, _, _, _), .tab(_, let title, _, _, _, _):
      return title
    }
  }

  private static func selection(
    for tabID: TerminalTabID,
    selectedTabID: TerminalTabID?,
    selectionState: TerminalTabSelectionState?
  ) -> SelectableRowSelection {
    selectionState?.style(for: tabID, primaryTabID: selectedTabID)
      ?? (tabID == selectedTabID ? .primary : .none)
  }
}

@MainActor
enum TerminalHorizontalTabOverflowMenu {
  static func make(
    model: TerminalHorizontalTabOverflowModel,
    selectTab: @escaping (TerminalTabID) -> Void,
    toggleGroup: @escaping (TerminalTabGroupID) -> Void
  ) -> NSMenu {
    let menu = NSMenu()
    var priorPinned: Bool?
    for item in model.items {
      if let priorPinned, priorPinned != item.isPinned {
        menu.addItem(.separator())
      }
      switch item {
      case .tab(let tab):
        menu.addItem(tabItem(tab, selectTab: selectTab))
      case .group(let group):
        menu.addItem(groupItem(group, selectTab: selectTab, toggleGroup: toggleGroup))
      }
      priorPinned = item.isPinned
    }
    return menu
  }

  private static func groupItem(
    _ group: TerminalHorizontalTabOverflowModel.Group,
    selectTab: @escaping (TerminalTabID) -> Void,
    toggleGroup: @escaping (TerminalTabGroupID) -> Void
  ) -> NSMenuItem {
    let item = NSMenuItem(title: group.title, action: nil, keyEquivalent: "")
    let submenu = NSMenu()
    if group.headerIsHidden {
      submenu.addAction(
        title: group.isCollapsed ? "Expand Group" : "Collapse Group",
        symbol: group.isCollapsed ? "chevron.down" : "chevron.right"
      ) {
        toggleGroup(group.id)
      }
      if !group.tabs.isEmpty {
        submenu.addItem(.separator())
      }
    }
    for tab in group.tabs {
      submenu.addItem(tabItem(tab, selectTab: selectTab))
    }
    item.submenu = submenu
    return item
  }

  private static func tabItem(
    _ tab: TerminalHorizontalTabOverflowModel.Tab,
    selectTab: @escaping (TerminalTabID) -> Void
  ) -> NSMenuItem {
    let item = NSMenuItem(title: tab.title, action: nil, keyEquivalent: "")
    let action = TerminalHorizontalTabOverflowAction {
      selectTab(tab.id)
    }
    item.action = #selector(TerminalHorizontalTabOverflowAction.performAction)
    item.target = action
    item.representedObject = action
    item.state =
      switch tab.selection {
      case .primary: .on
      case .secondary: .mixed
      case .none: .off
      }
    return item
  }
}

@MainActor
private final class TerminalHorizontalTabOverflowAction: NSObject {
  private let handler: () -> Void

  init(_ handler: @escaping () -> Void) {
    self.handler = handler
    super.init()
  }

  @objc func performAction() {
    handler()
  }
}
