import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarBatchTabMenuTests {
  @Test
  func groupedSelectionCanBePinned() throws {
    let fixture = try makeFixture()

    #expect(fixture.pinAction(for: fixture.groupedTabIDs) == .pin)
  }

  @Test
  func regularRootAndGroupedSelectionCanBePinned() throws {
    let fixture = try makeFixture()

    #expect(
      fixture.pinAction(for: [fixture.regularRootTabID, fixture.groupedTabID]) == .pin
    )
  }

  @Test
  func pinnedRootAndGroupedSelectionCannotTogglePinStateTogether() throws {
    let fixture = try makeFixture()

    #expect(
      fixture.pinAction(for: [fixture.pinnedRootTabID, fixture.groupedTabID]) == .disabled
    )
  }

  private func makeFixture() throws -> Fixture {
    let terminal = TerminalHostState(managesTerminalSurfaces: false)
    let manager = try #require(terminal.spaceManager.activeTabManager)
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

    func pinAction(for tabIDs: [TerminalTabID]) -> TerminalSidebarBatchTabMenu.PinAction {
      TerminalSidebarBatchTabMenu(
        store: Store(initialState: TerminalWindowFeature.State()) {
          TerminalWindowFeature()
        },
        terminal: terminal,
        tabIDs: tabIDs,
        contextualTabID: groupedTabID,
        renameState: nil
      ).pinAction
    }
  }
}
