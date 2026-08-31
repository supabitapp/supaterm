import Foundation
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalTabContextMenuModelTests {
  @Test
  func dispatcherMovesAndRemovesTabsFromGroups() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let manager = terminal.spaceManager.tabCollection
    let tabID = manager.createTab(title: "Loose")
    let groupedTabID = manager.createTab(title: "Grouped")
    let groupID = try #require(
      terminal.createGroup(title: "Work", containing: [groupedTabID])
    ).groupID
    let dispatcher = dispatcher(for: terminal)
    let moveModel = try model(for: .tab(tabID), terminal: terminal)
    let moveAction = try action(in: moveModel, submenu: "Move to Group...", title: "Work")

    dispatcher.perform(moveAction)

    #expect(manager.tabIDs(in: groupID) == [groupedTabID, tabID])
    let removeModel = try model(for: .tab(tabID), terminal: terminal)
    let removeAction = try action(in: removeModel, title: "Remove from Group")

    dispatcher.perform(removeAction)

    #expect(manager.tabIDs(in: groupID) == [groupedTabID])
    #expect(manager.rootItems.contains { $0.id == .tab(tabID) })
  }

  @Test
  func dispatcherCreatesGroupAndStartsRename() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Build")
    var rename: (TerminalTabGroupID, String)?
    let dispatcher = TerminalTabContextMenuDispatcher(
      terminal: terminal,
      beginGroupRename: { rename = ($0, $1) }
    )
    let menu = try model(for: .tab(tabID), terminal: terminal)

    dispatcher.perform(try action(in: menu, title: "Move to New Group"))

    let renamedGroup = try #require(rename)
    #expect(terminal.rootItems.contains { $0.id == .group(renamedGroup.0) })
    #expect(!renamedGroup.1.isEmpty)
  }

  @Test
  func dispatcherAppliesGroupRenameColorAndCollapseActions() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Grouped")
    let groupID = try #require(
      terminal.createGroup(title: "Work", containing: [tabID])
    ).groupID
    var rename: (TerminalTabGroupID, String)?
    let dispatcher = TerminalTabContextMenuDispatcher(
      terminal: terminal,
      beginGroupRename: { rename = ($0, $1) }
    )
    let menu = try model(for: .group(groupID), terminal: terminal)

    dispatcher.perform(try action(in: menu, title: "Rename Group"))
    dispatcher.perform(try action(in: menu, submenu: "Color", title: "Blue"))
    dispatcher.perform(try action(in: menu, title: "Collapse Group"))

    #expect(rename?.0 == groupID)
    #expect(rename?.1 == "Work")
    #expect(managerGroup(groupID, terminal: terminal)?.color == .blue)
    #expect(terminal.collapsedTabGroupIDs.contains(groupID))
  }

  @Test
  func horizontalAndSidebarGroupMenusShareMutationActions() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Grouped")
    let groupID = try #require(
      terminal.createGroup(title: "Work", containing: [tabID])
    ).groupID
    let horizontal = try model(
      for: .group(groupID),
      terminal: terminal,
      layout: .horizontal
    )
    let sidebar = try model(for: .group(groupID), terminal: terminal)

    let horizontalActions = sharedGroupActions(in: horizontal)
    let sidebarActions = sharedGroupActions(in: sidebar)
    #expect(horizontalActions.count == sidebarActions.count)
    #expect(horizontalActions.allSatisfy(sidebarActions.contains))
  }

  private func model(
    for entryID: TerminalSidebarEntryID,
    terminal: TerminalHostState,
    layout: TerminalTabContextMenuLayout = .sidebar
  ) throws -> TerminalTabContextMenuModel {
    let contextualTabIDs: [TerminalTabID] =
      switch entryID {
      case .tab(let tabID): [tabID]
      case .group, .newTab, .pinDivider: []
      }
    return try #require(
      TerminalTabContextMenuModel.menu(
        for: entryID,
        contextualTabIDs: contextualTabIDs,
        snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
        paneCount: 1,
        layout: layout
      )
    )
  }

  private func dispatcher(
    for terminal: TerminalHostState
  ) -> TerminalTabContextMenuDispatcher {
    TerminalTabContextMenuDispatcher(
      terminal: terminal,
      beginGroupRename: { _, _ in }
    )
  }

  private func action(
    in model: TerminalTabContextMenuModel,
    title: String
  ) throws -> TerminalTabContextMenuAction {
    for item in model.items {
      guard case .action(let action) = item, action.title == title else { continue }
      return action.action
    }
    Issue.record("Missing \(title) action")
    throw MissingAction()
  }

  private func action(
    in model: TerminalTabContextMenuModel,
    submenu title: String,
    title actionTitle: String
  ) throws -> TerminalTabContextMenuAction {
    for item in model.items {
      guard case .submenu(let submenu) = item, submenu.title == title else { continue }
      return try #require(submenu.items.first { $0.title == actionTitle }).action
    }
    Issue.record("Missing \(title) submenu")
    throw MissingAction()
  }

  private func sharedGroupActions(
    in model: TerminalTabContextMenuModel
  ) -> [TerminalTabContextMenuAction] {
    model.items.flatMap { item -> [TerminalTabContextMenuAction] in
      switch item {
      case .action(let action): return [action.action]
      case .submenu(let submenu): return submenu.items.map(\.action)
      case .separator: return []
      }
    }.filter {
      if case .createTabInGroup = $0 { return false }
      return true
    }
  }

  private func managerGroup(
    _ groupID: TerminalTabGroupID,
    terminal: TerminalHostState
  ) -> TerminalTabGroupItem? {
    terminal.rootItems.compactMap { root in
      guard case .group(let group) = root else { return nil }
      return group
    }.first { $0.id == groupID }
  }

  private struct MissingAction: Error {}
}
