import Foundation
import SupaTheme

enum TerminalTabContextMenuLayout: Equatable {
  case horizontal
  case sidebar
}

enum TerminalTabContextMenuItemState: Equatable {
  case off
  case on
  case mixed
}

enum TerminalTabContextMenuItemRole: Equatable {
  case standard
  case destructive
}

enum TerminalTabGroupTabInheritance: Equatable {
  case group
  case selected
}

enum TerminalTabContextMenuAction: Equatable {
  case createTab(inheritingFrom: TerminalTabID)
  case setTabsPinned(
    [TerminalTabID],
    isPinned: Bool,
    expectedTopologyRevision: UInt64
  )
  case moveAllPanesToNewTabs(TerminalTabID)
  case createGroup(containing: [TerminalTabID])
  case moveTabsToGroup(
    [TerminalTabID],
    groupID: TerminalTabGroupID,
    expectedTopologyRevision: UInt64
  )
  case removeTabsFromGroup(
    [TerminalTabID],
    expectedTopologyRevision: UInt64
  )
  case changeTabTitle(TerminalTabID)
  case closeTab(TerminalTabID)
  case closeTabs([TerminalTabID])
  case closeOtherTabs(keeping: [TerminalTabID])
  case closeTabsBelow(TerminalTabID)
  case toggleGroupPinned(TerminalTabGroupID)
  case createTabInGroup(
    TerminalTabGroupID,
    inheritance: TerminalTabGroupTabInheritance
  )
  case ungroup(TerminalTabGroupID)
  case renameGroup(TerminalTabGroupID, currentTitle: String)
  case setGroupColor(TerminalTabGroupID, ThemeTint)
  case toggleGroupCollapsed(TerminalTabGroupID)
  case closeGroup(TerminalTabGroupID)
}

struct TerminalTabContextMenuActionItem: Equatable {
  let title: String
  let symbol: String?
  let isEnabled: Bool
  let state: TerminalTabContextMenuItemState
  let role: TerminalTabContextMenuItemRole
  let action: TerminalTabContextMenuAction

  init(
    title: String,
    symbol: String? = nil,
    isEnabled: Bool = true,
    state: TerminalTabContextMenuItemState = .off,
    role: TerminalTabContextMenuItemRole = .standard,
    action: TerminalTabContextMenuAction
  ) {
    self.title = title
    self.symbol = symbol
    self.isEnabled = isEnabled
    self.state = state
    self.role = role
    self.action = action
  }
}

struct TerminalTabContextSubmenu: Equatable {
  let title: String
  let symbol: String
  let isEnabled: Bool
  let items: [TerminalTabContextMenuActionItem]
}

enum TerminalTabContextMenuItem: Equatable {
  case action(TerminalTabContextMenuActionItem)
  case submenu(TerminalTabContextSubmenu)
  case separator

  var title: String? {
    switch self {
    case .action(let item): item.title
    case .submenu(let submenu): submenu.title
    case .separator: nil
    }
  }
}

struct TerminalTabContextMenuModel: Equatable {
  let items: [TerminalTabContextMenuItem]

  static func menu(
    for entryID: TerminalSidebarEntryID,
    contextualTabIDs: [TerminalTabID],
    snapshot: TerminalTabSurfaceSnapshot,
    paneCount: Int,
    layout: TerminalTabContextMenuLayout
  ) -> Self? {
    switch entryID {
    case .tab(let tabID):
      if contextualTabIDs.count > 1 {
        return batchTabMenu(
          tabIDs: contextualTabIDs,
          contextualTabID: tabID,
          snapshot: snapshot,
          layout: layout
        )
      }
      return tabMenu(
        tabID: tabID,
        snapshot: snapshot,
        paneCount: paneCount,
        layout: layout
      )
    case .group(let groupID):
      return groupMenu(groupID: groupID, snapshot: snapshot, layout: layout)
    case .newTab, .pinDivider:
      return nil
    }
  }

  private enum BatchPinAction: Equatable {
    case pin
    case unpin
    case mixed
  }

  private struct TabContext {
    let groupID: TerminalTabGroupID?
    let isPinned: Bool
  }

  private struct TabItems {
    let newTab: TerminalTabContextMenuItem
    let pin: TerminalTabContextMenuItem
    let movePanes: TerminalTabContextMenuItem
    let moveToNewGroup: TerminalTabContextMenuItem
    let moveToGroup: TerminalTabContextMenuItem
    let removeFromGroup: TerminalTabContextMenuItem
    let changeTitle: TerminalTabContextMenuItem
    let close: TerminalTabContextMenuItem
    let closeOthers: TerminalTabContextMenuItem
  }

  private static func batchTabMenu(
    tabIDs: [TerminalTabID],
    contextualTabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot,
    layout: TerminalTabContextMenuLayout
  ) -> Self {
    let selected = Set(tabIDs)
    let pinAction = batchPinAction(tabIDs: tabIDs, snapshot: snapshot)
    let isPinned = pinAction == .pin
    let pinState: TerminalTabContextMenuItemState
    switch pinAction {
    case .pin: pinState = .off
    case .unpin: pinState = .on
    case .mixed: pinState = .mixed
    }
    var items: [TerminalTabContextMenuItem] = [
      action(
        "\(pinAction == .unpin ? "Unpin" : "Pin") \(tabIDs.count) Tabs",
        symbol: pinAction == .unpin ? "pin.slash" : "pin",
        isEnabled: pinAction != .mixed,
        state: pinState,
        action: .setTabsPinned(
          tabIDs,
          isPinned: isPinned,
          expectedTopologyRevision: snapshot.collection.topologyRevision
        )
      ),
      action(
        "New Group with \(tabIDs.count) Tabs",
        symbol: "rectangle.3.group",
        action: .createGroup(containing: tabIDs)
      ),
      groupSubmenu(
        tabIDs: tabIDs,
        currentGroupID: nil,
        includesCurrentGroup: true,
        snapshot: snapshot
      ),
    ]
    if sharedGroup(containing: selected, snapshot: snapshot) != nil {
      items.append(
        action(
          "Remove from Group",
          symbol: "arrow.up.backward",
          action: .removeTabsFromGroup(
            tabIDs,
            expectedTopologyRevision: snapshot.collection.topologyRevision
          )
        )
      )
    }
    items.append(.separator)
    items.append(
      action(
        "Close \(tabIDs.count) Tabs",
        symbol: "xmark",
        role: .destructive,
        action: .closeTabs(tabIDs)
      )
    )
    items.append(
      action(
        "Close Other Tabs",
        symbol: "xmark.circle",
        isEnabled: snapshot.collection.tabs.contains { !selected.contains($0.id) },
        action: .closeOtherTabs(keeping: tabIDs)
      )
    )
    switch layout {
    case .horizontal:
      let sides = tabsBesideSelection(tabIDs, snapshot: snapshot)
      items.append(
        action(
          "Close Tabs to Left",
          symbol: "arrow.left.to.line",
          isEnabled: !sides.before.isEmpty,
          action: .closeTabs(sides.before)
        )
      )
      items.append(
        action(
          "Close Tabs to Right",
          symbol: "arrow.right.to.line",
          isEnabled: !sides.after.isEmpty,
          action: .closeTabs(sides.after)
        )
      )
    case .sidebar:
      let hasTabsBelow = hasTabsBelow(contextualTabID, snapshot: snapshot)
      items.append(
        action(
          "Close Tabs Below",
          symbol: "arrow.down.to.line",
          isEnabled: hasTabsBelow,
          action: .closeTabsBelow(contextualTabID)
        )
      )
    }
    return Self(items: items)
  }

  private static func tabMenu(
    tabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot,
    paneCount: Int,
    layout: TerminalTabContextMenuLayout
  ) -> Self? {
    guard
      let context = tabContext(tabID: tabID, snapshot: snapshot),
      let tabIndex = snapshot.collection.tabs.firstIndex(where: { $0.id == tabID })
    else { return nil }
    let tabs = snapshot.collection.tabs
    let common = TabItems(
      newTab: action(
        "New Tab",
        symbol: "plus",
        action: .createTab(inheritingFrom: tabID)
      ),
      pin: action(
        context.isPinned ? "Unpin Tab" : "Pin Tab",
        symbol: context.isPinned ? "pin.slash" : "pin",
        action: .setTabsPinned(
          [tabID],
          isPinned: !context.isPinned,
          expectedTopologyRevision: snapshot.collection.topologyRevision
        )
      ),
      movePanes: action(
        "Move All Panes to New Tabs",
        symbol: "rectangle.stack.badge.plus",
        action: .moveAllPanesToNewTabs(tabID)
      ),
      moveToNewGroup: action(
        "Move to New Group",
        symbol: "rectangle.3.group",
        action: .createGroup(containing: [tabID])
      ),
      moveToGroup: groupSubmenu(
        tabIDs: [tabID],
        currentGroupID: context.groupID,
        includesCurrentGroup: false,
        snapshot: snapshot
      ),
      removeFromGroup: action(
        "Remove from Group",
        symbol: "arrow.up.backward",
        action: .removeTabsFromGroup(
          [tabID],
          expectedTopologyRevision: snapshot.collection.topologyRevision
        )
      ),
      changeTitle: action(
        "Change Tab Title...",
        symbol: "pencil",
        action: .changeTabTitle(tabID)
      ),
      close: action(
        "Close",
        symbol: "xmark",
        role: .destructive,
        action: .closeTab(tabID)
      ),
      closeOthers: action(
        "Close Others",
        symbol: "xmark.circle",
        isEnabled: tabs.count > 1,
        action: .closeOtherTabs(keeping: [tabID])
      )
    )
    switch layout {
    case .horizontal:
      return horizontalTabMenu(
        context: context,
        tabs: tabs,
        tabIndex: tabIndex,
        paneCount: paneCount,
        common: common
      )
    case .sidebar:
      return sidebarTabMenu(
        tabID: tabID,
        context: context,
        snapshot: snapshot,
        paneCount: paneCount,
        common: common
      )
    }
  }

  private static func horizontalTabMenu(
    context: TabContext,
    tabs: [TerminalTabItem],
    tabIndex: Array<TerminalTabItem>.Index,
    paneCount: Int,
    common: TabItems
  ) -> Self {
    var items: [TerminalTabContextMenuItem] = [
      common.newTab,
      .separator,
      common.pin,
    ]
    if paneCount > 1 {
      items.append(.separator)
      items.append(common.movePanes)
    }
    items.append(contentsOf: [.separator, common.moveToNewGroup])
    if context.groupID != nil {
      items.append(common.removeFromGroup)
    }
    items.append(common.moveToGroup)
    items.append(
      contentsOf: [.separator, common.changeTitle, .separator, common.close, common.closeOthers]
    )
    items.append(
      action(
        "Close Tabs to Left",
        symbol: "arrow.left.to.line",
        isEnabled: tabIndex > tabs.startIndex,
        action: .closeTabs(tabs[..<tabIndex].map(\.id))
      )
    )
    items.append(
      action(
        "Close Tabs to Right",
        symbol: "arrow.right.to.line",
        isEnabled: tabIndex < tabs.index(before: tabs.endIndex),
        action: .closeTabs(tabs[tabs.index(after: tabIndex)...].map(\.id))
      )
    )
    return Self(items: items)
  }

  private static func sidebarTabMenu(
    tabID: TerminalTabID,
    context: TabContext,
    snapshot: TerminalTabSurfaceSnapshot,
    paneCount: Int,
    common: TabItems
  ) -> Self {
    var items: [TerminalTabContextMenuItem] = [
      common.newTab,
      .separator,
      common.pin,
      common.moveToNewGroup,
      common.moveToGroup,
    ]
    if paneCount > 1 {
      items.append(common.movePanes)
    }
    if context.groupID != nil {
      items.append(common.removeFromGroup)
    }
    items.append(common.changeTitle)
    items.append(.separator)
    items.append(
      action(
        "Close All Below",
        symbol: "arrow.down.to.line",
        isEnabled: hasTabsBelow(tabID, snapshot: snapshot),
        action: .closeTabsBelow(tabID)
      )
    )
    items.append(common.closeOthers)
    items.append(contentsOf: [.separator, common.close])
    return Self(items: items)
  }

  private static func groupMenu(
    groupID: TerminalTabGroupID,
    snapshot: TerminalTabSurfaceSnapshot,
    layout: TerminalTabContextMenuLayout
  ) -> Self? {
    guard let group = groups(in: snapshot).first(where: { $0.id == groupID }) else {
      return nil
    }
    let isCollapsed = snapshot.collapsedGroupIDs.contains(groupID)
    let pin = action(
      group.isPinned ? "Unpin Group" : "Pin Group",
      symbol: group.isPinned ? "pin.slash" : "pin",
      action: .toggleGroupPinned(groupID)
    )
    let newTab = action(
      "New Tab in Group",
      symbol: "plus",
      action: .createTabInGroup(
        groupID,
        inheritance: layout == .horizontal ? .group : .selected
      )
    )
    let ungroup = action(
      "Ungroup",
      symbol: "rectangle.3.group.bubble.left",
      action: .ungroup(groupID)
    )
    let rename = action(
      "Rename Group",
      symbol: "pencil",
      action: .renameGroup(groupID, currentTitle: group.title)
    )
    let color = colorSubmenu(group: group)
    let collapse = action(
      isCollapsed ? "Expand Group" : "Collapse Group",
      symbol: isCollapsed ? "chevron.down" : "chevron.right",
      action: .toggleGroupCollapsed(groupID)
    )
    let close = action(
      "Close Group",
      symbol: "xmark",
      role: .destructive,
      action: .closeGroup(groupID)
    )
    switch layout {
    case .horizontal:
      return Self(
        items: [
          pin,
          .separator,
          newTab,
          ungroup,
          .separator,
          rename,
          color,
          collapse,
          .separator,
          close,
        ]
      )
    case .sidebar:
      return Self(
        items: [
          newTab,
          rename,
          color,
          pin,
          collapse,
          .separator,
          ungroup,
          close,
        ]
      )
    }
  }

  private static func groupSubmenu(
    tabIDs: [TerminalTabID],
    currentGroupID: TerminalTabGroupID?,
    includesCurrentGroup: Bool,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> TerminalTabContextMenuItem {
    let selected = Set(tabIDs)
    let groups = groups(in: snapshot).filter { includesCurrentGroup || $0.id != currentGroupID }
    let items = groups.map { group in
      let remainingTabIDs = group.tabs.map(\.id).filter { !selected.contains($0) }
      return TerminalTabContextMenuActionItem(
        title: group.title,
        isEnabled: remainingTabIDs + tabIDs != group.tabs.map(\.id),
        action: .moveTabsToGroup(
          tabIDs,
          groupID: group.id,
          expectedTopologyRevision: snapshot.collection.topologyRevision
        )
      )
    }
    return .submenu(
      TerminalTabContextSubmenu(
        title: tabIDs.count > 1 ? "Move to Group" : "Move to Group...",
        symbol: "arrow.right",
        isEnabled: !groups.isEmpty,
        items: items
      )
    )
  }

  private static func colorSubmenu(
    group: TerminalTabGroupItem
  ) -> TerminalTabContextMenuItem {
    .submenu(
      TerminalTabContextSubmenu(
        title: "Color",
        symbol: "paintpalette",
        isEnabled: true,
        items: ThemeTint.allCases.map { color in
          TerminalTabContextMenuActionItem(
            title: color.displayName,
            state: color == group.color ? .on : .off,
            action: .setGroupColor(group.id, color)
          )
        }
      )
    )
  }

  private static func action(
    _ title: String,
    symbol: String,
    isEnabled: Bool = true,
    state: TerminalTabContextMenuItemState = .off,
    role: TerminalTabContextMenuItemRole = .standard,
    action: TerminalTabContextMenuAction
  ) -> TerminalTabContextMenuItem {
    .action(
      TerminalTabContextMenuActionItem(
        title: title,
        symbol: symbol,
        isEnabled: isEnabled,
        state: state,
        role: role,
        action: action
      )
    )
  }

  private static func groups(
    in snapshot: TerminalTabSurfaceSnapshot
  ) -> [TerminalTabGroupItem] {
    snapshot.collection.rootItems.compactMap { root in
      guard case .group(let group) = root else { return nil }
      return group
    }
  }

  private static func tabContext(
    tabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> TabContext? {
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item) where item.tab.id == tabID:
        return TabContext(groupID: nil, isPinned: item.isPinned)
      case .group(let group) where group.tabs.contains(where: { $0.id == tabID }):
        return TabContext(groupID: group.id, isPinned: false)
      default:
        continue
      }
    }
    return nil
  }

  private static func batchPinAction(
    tabIDs: [TerminalTabID],
    snapshot: TerminalTabSurfaceSnapshot
  ) -> BatchPinAction {
    let states = Set(tabIDs.compactMap { tabContext(tabID: $0, snapshot: snapshot)?.isPinned })
    guard states.count == 1, let isPinned = states.first else { return .mixed }
    return isPinned ? .unpin : .pin
  }

  private static func sharedGroup(
    containing selected: Set<TerminalTabID>,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> TerminalTabGroupItem? {
    groups(in: snapshot).first { selected.isSubset(of: Set($0.tabs.map(\.id))) }
  }

  private static func tabsBesideSelection(
    _ tabIDs: [TerminalTabID],
    snapshot: TerminalTabSurfaceSnapshot
  ) -> (before: [TerminalTabID], after: [TerminalTabID]) {
    let tabs = snapshot.collection.tabs
    let selected = Set(tabIDs)
    let indices = tabs.indices.filter { selected.contains(tabs[$0].id) }
    guard let first = indices.first, let last = indices.last else { return ([], []) }
    return (
      tabs[..<first].map(\.id),
      tabs[tabs.index(after: last)...].map(\.id)
    )
  }

  private static func hasTabsBelow(
    _ tabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> Bool {
    guard let index = snapshot.collection.tabs.firstIndex(where: { $0.id == tabID }) else {
      return false
    }
    return snapshot.collection.tabs.index(after: index) < snapshot.collection.tabs.endIndex
  }
}

@MainActor
struct TerminalTabContextMenuDispatcher {
  let terminal: TerminalHostState
  let beginGroupRename: (TerminalTabGroupID, String) -> Void

  func perform(_ action: TerminalTabContextMenuAction) {
    if performTabAction(action) { return }
    performGroupAction(action)
  }

  private func performTabAction(_ action: TerminalTabContextMenuAction) -> Bool {
    switch action {
    case .createTab(let tabID):
      AppPostHog.capture("terminal_tab_created")
      _ = terminal.createTab(inheritingFromSurfaceID: terminal.contextSurfaceID(for: tabID))
    case .setTabsPinned(let tabIDs, let isPinned, let revision):
      setTabsPinned(tabIDs, isPinned: isPinned, expectedTopologyRevision: revision)
    case .moveAllPanesToNewTabs(let tabID):
      terminal.moveAllPanesToNewTabs(tabID)
    case .createGroup(let tabIDs):
      createGroup(containing: tabIDs)
    case .moveTabsToGroup(let tabIDs, let groupID, let revision):
      moveTabsToGroup(tabIDs, groupID: groupID, expectedTopologyRevision: revision)
    case .removeTabsFromGroup(let tabIDs, let revision):
      removeTabsFromGroup(tabIDs, expectedTopologyRevision: revision)
    case .changeTabTitle(let tabID):
      terminal.promptTabTitle(tabID)
    case .closeTab(let tabID):
      terminal.requestCloseTab(tabID)
    case .closeTabs(let tabIDs):
      terminal.requestCloseTabs(tabIDs)
    case .closeOtherTabs(let tabIDs):
      terminal.requestCloseOtherTabs(keeping: tabIDs)
    case .closeTabsBelow(let tabID):
      terminal.requestCloseTabsBelow(tabID)
    case .toggleGroupPinned, .createTabInGroup, .ungroup, .renameGroup, .setGroupColor,
      .toggleGroupCollapsed, .closeGroup:
      return false
    }
    return true
  }

  private func performGroupAction(_ action: TerminalTabContextMenuAction) {
    switch action {
    case .toggleGroupPinned(let groupID):
      terminal.togglePinned(.group(groupID))
    case .createTabInGroup(let groupID, let inheritance):
      AppPostHog.capture("terminal_tab_created")
      let surfaceID =
        switch inheritance {
        case .group: terminal.contextSurfaceID(for: groupID)
        case .selected: terminal.selectedSurfaceView?.id
        }
      _ = terminal.createTab(in: groupID, inheritingFromSurfaceID: surfaceID)
    case .ungroup(let groupID):
      terminal.ungroup(groupID)
    case .renameGroup(let groupID, let currentTitle):
      beginGroupRename(groupID, currentTitle)
    case .setGroupColor(let groupID, let color):
      terminal.setGroupColor(groupID, color: color)
    case .toggleGroupCollapsed(let groupID):
      terminal.toggleGroupCollapsed(groupID)
    case .closeGroup(let groupID):
      terminal.requestCloseGroup(groupID)
    case .createTab, .setTabsPinned, .moveAllPanesToNewTabs, .createGroup, .moveTabsToGroup,
      .removeTabsFromGroup, .changeTabTitle, .closeTab, .closeTabs, .closeOtherTabs,
      .closeTabsBelow:
      break
    }
  }

  private func createGroup(containing tabIDs: [TerminalTabID]) {
    guard let title = terminal.suggestedGroupTitle(containing: tabIDs) else { return }
    guard
      let result = terminal.createGroup(
        title: title,
        color: .neutral,
        containing: tabIDs
      )
    else { return }
    beginGroupRename(result.groupID, title)
  }

  private func setTabsPinned(
    _ tabIDs: [TerminalTabID],
    isPinned: Bool,
    expectedTopologyRevision: UInt64
  ) {
    let destinationIndex = terminal.rootItems.count { $0.isPinned == isPinned }
    move(
      tabIDs,
      to: .root(TerminalRootPlacement(isPinned: isPinned, index: destinationIndex)),
      expectedTopologyRevision: expectedTopologyRevision
    )
  }

  private func moveTabsToGroup(
    _ tabIDs: [TerminalTabID],
    groupID: TerminalTabGroupID,
    expectedTopologyRevision: UInt64
  ) {
    guard let group = groups.first(where: { $0.id == groupID }) else { return }
    let selected = Set(tabIDs)
    let destinationIndex = group.tabs.count { !selected.contains($0.id) }
    move(
      tabIDs,
      to: .group(groupID, index: destinationIndex),
      expectedTopologyRevision: expectedTopologyRevision
    )
  }

  private func removeTabsFromGroup(
    _ tabIDs: [TerminalTabID],
    expectedTopologyRevision: UInt64
  ) {
    let selected = Set(tabIDs)
    guard
      let group = groups.first(where: {
        selected.isSubset(of: Set($0.tabs.map(\.id)))
      })
    else { return }
    let lane = terminal.rootItems.filter { $0.isPinned == group.isPinned }
    guard let index = lane.firstIndex(where: { $0.id == .group(group.id) }) else { return }
    let groupIsDeleted =
      group.lifetime == .automatic
      && Set(group.tabs.map(\.id)).isSubset(of: selected)
    move(
      tabIDs,
      to: .root(
        TerminalRootPlacement(
          isPinned: group.isPinned,
          index: index + (groupIsDeleted ? 0 : 1)
        )
      ),
      expectedTopologyRevision: expectedTopologyRevision
    )
  }

  private var groups: [TerminalTabGroupItem] {
    terminal.rootItems.compactMap { root in
      guard case .group(let group) = root else { return nil }
      return group
    }
  }

  private func move(
    _ tabIDs: [TerminalTabID],
    to destination: TerminalTabPlacement,
    expectedTopologyRevision: UInt64
  ) {
    _ = try? terminal.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: expectedTopologyRevision,
        itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
        destination: destination
      )
    )
  }
}
