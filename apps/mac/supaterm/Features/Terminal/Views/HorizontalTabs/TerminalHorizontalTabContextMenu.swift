import AppKit
import SupaTheme

@MainActor
enum TerminalHorizontalTabContextMenu {
  static func menu(
    for entryID: TerminalSidebarEntryID,
    snapshot: TerminalTabSurfaceSnapshot,
    surface: TerminalHorizontalTabSurfacePresentation,
    terminal: TerminalHostState,
    selectionState: TerminalTabSelectionState? = nil
  ) -> NSMenu? {
    switch entryID {
    case .tab(let tabID):
      let contextualTabIDs =
        selectionState?.contextualTabIDs(
          for: tabID,
          primaryTabID: snapshot.collection.selectedTabID,
          visibleTabIDs: TerminalSidebarOutline(snapshot: snapshot).visibleTabIDs
        ) ?? [tabID]
      if contextualTabIDs.count > 1 {
        return batchTabMenu(
          tabIDs: contextualTabIDs,
          snapshot: snapshot,
          terminal: terminal
        )
      }
      return tabMenu(
        tabID: tabID,
        snapshot: snapshot,
        surface: surface,
        terminal: terminal
      )
    case .group(let groupID):
      return groupMenu(groupID: groupID, snapshot: snapshot, terminal: terminal)
    case .newTab, .pinDivider:
      return nil
    }
  }

  private enum BatchPinAction: Equatable {
    case pin
    case unpin
    case mixed
  }

  private static func batchTabMenu(
    tabIDs: [TerminalTabID],
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) -> NSMenu {
    let menu = NSMenu()
    let selected = Set(tabIDs)
    let pinAction = batchPinAction(tabIDs: tabIDs, terminal: terminal)
    let pinItem = menu.addAction(
      title: "\(pinAction == .unpin ? "Unpin" : "Pin") \(tabIDs.count) Tabs",
      symbol: pinAction == .unpin ? "pin.slash" : "pin",
      isEnabled: pinAction != .mixed
    ) {
      guard pinAction != .mixed else { return }
      let isPinned = pinAction == .pin
      let destinationIndex = terminal.rootItems.count { $0.isPinned == isPinned }
      move(
        tabIDs,
        to: .root(TerminalRootPlacement(isPinned: isPinned, index: destinationIndex)),
        snapshot: snapshot,
        terminal: terminal
      )
    }
    pinItem.state =
      switch pinAction {
      case .pin: .off
      case .unpin: .on
      case .mixed: .mixed
      }
    menu.addAction(
      title: "New Group with \(tabIDs.count) Tabs",
      symbol: "rectangle.3.group"
    ) {
      guard let title = terminal.suggestedGroupTitle(containing: tabIDs) else { return }
      guard
        let result = terminal.createGroup(
          title: title,
          color: .neutral,
          containing: tabIDs
        )
      else { return }
      terminal.promptGroupTitle(result.groupID)
    }
    menu.addItem(
      batchGroupSubmenu(
        tabIDs: tabIDs,
        selected: selected,
        snapshot: snapshot,
        terminal: terminal
      )
    )
    if let group = sharedGroup(containing: selected, snapshot: snapshot) {
      menu.addAction(title: "Remove from Group", symbol: "arrow.up.backward") {
        remove(
          tabIDs: tabIDs,
          from: group,
          snapshot: snapshot,
          terminal: terminal
        )
      }
    }
    menu.addItem(.separator())
    menu.addAction(title: "Close \(tabIDs.count) Tabs", symbol: "xmark") {
      terminal.requestCloseTabs(tabIDs)
    }
    menu.addAction(
      title: "Close Other Tabs",
      symbol: "xmark.circle",
      isEnabled: snapshot.collection.tabs.contains { !selected.contains($0.id) }
    ) {
      terminal.requestCloseOtherTabs(keeping: tabIDs)
    }
    let sides = tabsBesideSelection(tabIDs, snapshot: snapshot)
    menu.addAction(
      title: "Close Tabs to Left",
      symbol: "arrow.left.to.line",
      isEnabled: !sides.before.isEmpty
    ) {
      terminal.requestCloseTabs(sides.before)
    }
    menu.addAction(
      title: "Close Tabs to Right",
      symbol: "arrow.right.to.line",
      isEnabled: !sides.after.isEmpty
    ) {
      terminal.requestCloseTabs(sides.after)
    }
    return menu
  }

  private static func batchPinAction(
    tabIDs: [TerminalTabID],
    terminal: TerminalHostState
  ) -> BatchPinAction {
    let states = Set(tabIDs.map(terminal.isPinned))
    guard states.count == 1, let isPinned = states.first else { return .mixed }
    return isPinned ? .unpin : .pin
  }

  private static func batchGroupSubmenu(
    tabIDs: [TerminalTabID],
    selected: Set<TerminalTabID>,
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) -> NSMenuItem {
    let parent = NSMenuItem(title: "Move to Group", action: nil, keyEquivalent: "")
    parent.image = NSImage(systemSymbolName: "arrow.right", accessibilityDescription: nil)
    let submenu = NSMenu()
    let groups = snapshot.collection.rootItems.compactMap { root -> TerminalTabGroupItem? in
      guard case .group(let group) = root else { return nil }
      return group
    }
    for group in groups {
      let remainingTabIDs = group.tabs.map(\.id).filter { !selected.contains($0) }
      submenu.addAction(
        title: group.title,
        isEnabled: remainingTabIDs + tabIDs != group.tabs.map(\.id)
      ) {
        move(
          tabIDs,
          to: .group(group.id, index: remainingTabIDs.count),
          snapshot: snapshot,
          terminal: terminal
        )
      }
    }
    parent.submenu = submenu
    parent.isEnabled = !groups.isEmpty
    return parent
  }

  private static func sharedGroup(
    containing selected: Set<TerminalTabID>,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> TerminalTabGroupItem? {
    snapshot.collection.rootItems.compactMap { root -> TerminalTabGroupItem? in
      guard case .group(let group) = root else { return nil }
      return group
    }.first { selected.isSubset(of: Set($0.tabs.map(\.id))) }
  }

  private static func remove(
    tabIDs: [TerminalTabID],
    from group: TerminalTabGroupItem,
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) {
    let lane = snapshot.collection.rootItems.filter { $0.isPinned == group.isPinned }
    guard let index = lane.firstIndex(where: { $0.id == .group(group.id) }) else { return }
    let selected = Set(tabIDs)
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
      snapshot: snapshot,
      terminal: terminal
    )
  }

  private static func move(
    _ tabIDs: [TerminalTabID],
    to destination: TerminalTabPlacement,
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) {
    _ = try? terminal.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: snapshot.collection.topologyRevision,
        itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
        destination: destination
      )
    )
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

  private static func tabMenu(
    tabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot,
    surface: TerminalHorizontalTabSurfacePresentation,
    terminal: TerminalHostState
  ) -> NSMenu? {
    guard
      let context = tabContext(tabID: tabID, snapshot: snapshot),
      let tabIndex = snapshot.collection.tabs.firstIndex(where: { $0.id == tabID })
    else { return nil }
    let tabs = snapshot.collection.tabs
    let menu = NSMenu()
    menu.addAction(title: "New Tab", symbol: "plus") {
      AppPostHog.capture("terminal_tab_created")
      _ = terminal.createTab(inheritingFromSurfaceID: terminal.contextSurfaceID(for: tabID))
    }
    menu.addItem(.separator())
    menu.addAction(
      title: context.isPinned ? "Unpin Tab" : "Pin Tab",
      symbol: context.isPinned ? "pin.slash" : "pin"
    ) {
      terminal.togglePinned(tabID)
    }
    if surface.tabsByID[tabID]?.panes.count ?? 0 > 1 {
      menu.addItem(.separator())
      menu.addAction(title: "Move All Panes to New Tabs", symbol: "rectangle.stack.badge.plus") {
        terminal.moveAllPanesToNewTabs(tabID)
      }
    }
    menu.addItem(.separator())
    menu.addAction(title: "Move to New Group", symbol: "rectangle.3.group") {
      guard let title = terminal.suggestedGroupTitle(containing: [tabID]) else { return }
      guard let result = terminal.createGroup(title: title, containing: [tabID]) else { return }
      terminal.promptGroupTitle(result.groupID)
    }
    if context.groupID != nil {
      menu.addAction(title: "Remove from Group", symbol: "arrow.up.backward") {
        terminal.removeTabFromGroup(tabID)
      }
    }
    menu.addItem(
      groupSubmenu(
        tabID: tabID,
        currentGroupID: context.groupID,
        snapshot: snapshot,
        terminal: terminal
      )
    )
    menu.addItem(.separator())
    menu.addAction(title: "Change Tab Title...", symbol: "pencil") {
      terminal.promptTabTitle(tabID)
    }
    menu.addItem(.separator())
    menu.addAction(title: "Close", symbol: "xmark") {
      terminal.requestCloseTab(tabID)
    }
    menu.addAction(
      title: "Close Others",
      symbol: "xmark.circle",
      isEnabled: tabs.count > 1
    ) {
      terminal.requestCloseOtherTabs(keeping: [tabID])
    }
    menu.addAction(
      title: "Close Tabs to Left",
      symbol: "arrow.left.to.line",
      isEnabled: tabIndex > tabs.startIndex
    ) {
      terminal.requestCloseTabs(tabs[..<tabIndex].map(\.id))
    }
    menu.addAction(
      title: "Close Tabs to Right",
      symbol: "arrow.right.to.line",
      isEnabled: tabIndex < tabs.index(before: tabs.endIndex)
    ) {
      terminal.requestCloseTabsBelow(tabID)
    }
    return menu
  }

  private static func groupMenu(
    groupID: TerminalTabGroupID,
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) -> NSMenu? {
    guard
      let group = snapshot.collection.rootItems.compactMap({ root -> TerminalTabGroupItem? in
        guard case .group(let group) = root, group.id == groupID else { return nil }
        return group
      }).first
    else { return nil }
    let isCollapsed = snapshot.collapsedGroupIDs.contains(groupID)
    let menu = NSMenu()
    menu.addAction(
      title: group.isPinned ? "Unpin Group" : "Pin Group",
      symbol: group.isPinned ? "pin.slash" : "pin"
    ) {
      terminal.togglePinned(.group(groupID))
    }
    menu.addItem(.separator())
    menu.addAction(title: "New Tab in Group", symbol: "plus") {
      AppPostHog.capture("terminal_tab_created")
      _ = terminal.createTab(
        in: groupID,
        inheritingFromSurfaceID: terminal.contextSurfaceID(for: groupID)
      )
    }
    menu.addAction(title: "Ungroup", symbol: "rectangle.3.group.bubble.left") {
      terminal.ungroup(groupID)
    }
    menu.addItem(.separator())
    menu.addAction(title: "Rename Group", symbol: "pencil") {
      terminal.promptGroupTitle(groupID)
    }
    menu.addItem(colorSubmenu(group: group, terminal: terminal))
    menu.addAction(
      title: isCollapsed ? "Expand Group" : "Collapse Group",
      symbol: isCollapsed ? "chevron.down" : "chevron.right"
    ) {
      terminal.toggleGroupCollapsed(groupID)
    }
    menu.addItem(.separator())
    menu.addAction(title: "Close Group", symbol: "xmark") {
      terminal.requestCloseGroup(groupID)
    }
    return menu
  }

  private static func groupSubmenu(
    tabID: TerminalTabID,
    currentGroupID: TerminalTabGroupID?,
    snapshot: TerminalTabSurfaceSnapshot,
    terminal: TerminalHostState
  ) -> NSMenuItem {
    let parent = NSMenuItem(title: "Move to Group...", action: nil, keyEquivalent: "")
    parent.image = NSImage(systemSymbolName: "arrow.right", accessibilityDescription: nil)
    let submenu = NSMenu()
    let groups = snapshot.collection.rootItems.compactMap { root -> TerminalTabGroupItem? in
      guard case .group(let group) = root, group.id != currentGroupID else { return nil }
      return group
    }
    for group in groups {
      submenu.addAction(title: group.title) {
        _ = try? terminal.move(
          TerminalTabMoveRequest(
            expectedTopologyRevision: snapshot.collection.topologyRevision,
            itemIDs: [.tab(tabID)],
            destination: .group(group.id, index: group.tabs.count)
          )
        )
      }
    }
    parent.submenu = submenu
    parent.isEnabled = !groups.isEmpty
    return parent
  }

  private static func colorSubmenu(
    group: TerminalTabGroupItem,
    terminal: TerminalHostState
  ) -> NSMenuItem {
    let parent = NSMenuItem(title: "Color", action: nil, keyEquivalent: "")
    parent.image = NSImage(systemSymbolName: "paintpalette", accessibilityDescription: nil)
    let submenu = NSMenu()
    for color in ThemeTint.allCases {
      let item = submenu.addAction(title: color.displayName) {
        terminal.setGroupColor(group.id, color: color)
      }
      item.state = color == group.color ? .on : .off
    }
    parent.submenu = submenu
    return parent
  }

  private static func tabContext(
    tabID: TerminalTabID,
    snapshot: TerminalTabSurfaceSnapshot
  ) -> (groupID: TerminalTabGroupID?, isPinned: Bool)? {
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item) where item.tab.id == tabID:
        return (nil, item.isPinned)
      case .group(let group) where group.tabs.contains(where: { $0.id == tabID }):
        return (group.id, false)
      default:
        continue
      }
    }
    return nil
  }
}

@MainActor
private final class TerminalHorizontalTabMenuAction: NSObject {
  private let handler: () -> Void

  init(handler: @escaping () -> Void) {
    self.handler = handler
    super.init()
  }

  @objc func performAction() {
    handler()
  }
}

@MainActor
extension NSMenu {
  @discardableResult
  func addAction(
    title: String,
    symbol: String? = nil,
    isEnabled: Bool = true,
    handler: @escaping () -> Void
  ) -> NSMenuItem {
    let action = TerminalHorizontalTabMenuAction(handler: handler)
    let item = NSMenuItem(
      title: title,
      action: #selector(TerminalHorizontalTabMenuAction.performAction),
      keyEquivalent: ""
    )
    item.target = action
    item.representedObject = action
    item.isEnabled = isEnabled
    item.image = symbol.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
    addItem(item)
    return item
  }
}
