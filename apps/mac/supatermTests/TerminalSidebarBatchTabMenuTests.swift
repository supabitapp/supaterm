import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarBatchTabMenuTests {
  @Test
  func groupedSelectionCanBePinned() throws {
    let fixture = try makeFixture()
    let item = try fixture.pinItem(for: fixture.groupedTabIDs)

    #expect(item.title == "Pin 2 Tabs")
    #expect(item.isEnabled)
    #expect(item.state == .off)
  }

  @Test
  func regularRootAndGroupedSelectionCanBePinned() throws {
    let fixture = try makeFixture()
    let item = try fixture.pinItem(
      for: [fixture.regularRootTabID, fixture.groupedTabID]
    )

    #expect(item.title == "Pin 2 Tabs")
    #expect(item.isEnabled)
    #expect(item.state == .off)
  }

  @Test
  func pinnedRootAndGroupedSelectionCannotTogglePinStateTogether() throws {
    let fixture = try makeFixture()
    let item = try fixture.pinItem(
      for: [fixture.pinnedRootTabID, fixture.groupedTabID]
    )

    #expect(item.title == "Pin 2 Tabs")
    #expect(!item.isEnabled)
    #expect(item.state == .mixed)
  }

  @Test
  func horizontalAndSidebarMenusShareBatchMutationActions() throws {
    let fixture = try makeFixture()
    let snapshot = fixture.terminal.spaceManager.displayedInstance.tabSurfaceSnapshot
    let horizontal = try #require(
      TerminalTabContextMenuModel.menu(
        for: .tab(fixture.groupedTabID),
        contextualTabIDs: fixture.groupedTabIDs,
        snapshot: snapshot,
        paneCount: 1,
        layout: .horizontal
      )
    )
    let sidebar = try #require(
      TerminalTabContextMenuModel.menu(
        for: .tab(fixture.groupedTabID),
        contextualTabIDs: fixture.groupedTabIDs,
        snapshot: snapshot,
        paneCount: 1,
        layout: .sidebar
      )
    )

    #expect(Array(actions(in: horizontal).prefix(6)) == Array(actions(in: sidebar).prefix(6)))
  }

  private func actions(
    in model: TerminalTabContextMenuModel
  ) -> [TerminalTabContextMenuAction] {
    model.items.flatMap { item -> [TerminalTabContextMenuAction] in
      switch item {
      case .action(let action): return [action.action]
      case .submenu(let submenu): return submenu.items.map(\.action)
      case .separator: return []
      }
    }
  }

  private func makeFixture() throws -> Fixture {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let manager = terminal.spaceManager.tabCollection
    let regularRootTabID = manager.createTab(title: "Regular")
    let pinnedRootTabID = manager.createTab(title: "Pinned")
    let firstGroupedTabID = manager.createTab(title: "First Grouped")
    let secondGroupedTabID = manager.createTab(title: "Second Grouped")
    _ = try #require(
      manager.createGroup(
        title: "Group",
        containing: [firstGroupedTabID, secondGroupedTabID]
      )
    )
    #expect(terminal.setTabPinned(pinnedRootTabID, isPinned: true) != nil)

    return Fixture(
      terminal: terminal,
      regularRootTabID: regularRootTabID,
      pinnedRootTabID: pinnedRootTabID,
      groupedTabID: firstGroupedTabID,
      groupedTabIDs: [firstGroupedTabID, secondGroupedTabID]
    )
  }

  private struct Fixture {
    let terminal: TerminalHostState
    let regularRootTabID: TerminalTabID
    let pinnedRootTabID: TerminalTabID
    let groupedTabID: TerminalTabID
    let groupedTabIDs: [TerminalTabID]

    func pinItem(
      for tabIDs: [TerminalTabID]
    ) throws -> TerminalTabContextMenuActionItem {
      let model = try #require(
        TerminalTabContextMenuModel.menu(
          for: .tab(groupedTabID),
          contextualTabIDs: tabIDs,
          snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
          paneCount: 1,
          layout: .sidebar
        )
      )
      guard case .action(let item) = model.items.first else {
        Issue.record("Expected the pin action first")
        throw MissingPinAction()
      }
      return item
    }
  }

  private struct MissingPinAction: Error {}
}
