import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarBatchTabMenuTests {
  @Test
  func projectSelectionCanBePinned() throws {
    let fixture = try makeFixture()

    #expect(fixture.pinAction(for: fixture.projectTabIDs) == .pin)
  }

  @Test
  func unassignedAndProjectSelectionCanBePinned() throws {
    let fixture = try makeFixture()

    #expect(
      fixture.pinAction(for: [fixture.unassignedTabID, fixture.projectTabID]) == .pin
    )
  }

  @Test
  func mixedPinStateCannotToggleTogether() throws {
    let fixture = try makeFixture()

    #expect(
      fixture.pinAction(for: [fixture.pinnedTabID, fixture.projectTabID]) == .disabled
    )
  }

  private func makeFixture() throws -> Fixture {
    let terminal = TerminalHostState(managesTerminalSurfaces: false)
    let manager = terminal.spaceManager.tabCollection
    let unassignedTabID = manager.createTab(title: "Regular")
    let pinnedTabID = manager.createTab(title: "Pinned")
    let firstProjectTabID = manager.createTab(title: "First Project")
    let secondProjectTabID = manager.createTab(title: "Second Project")
    _ = try #require(
      terminal.createProject(
        name: "Project",
        containing: [firstProjectTabID, secondProjectTabID]
      )
    )
    #expect(terminal.setTabPinned(pinnedTabID, isPinned: true) != nil)

    return Fixture(
      terminal: terminal,
      unassignedTabID: unassignedTabID,
      pinnedTabID: pinnedTabID,
      projectTabID: firstProjectTabID,
      projectTabIDs: [firstProjectTabID, secondProjectTabID]
    )
  }

  private struct Fixture {
    let terminal: TerminalHostState
    let unassignedTabID: TerminalTabID
    let pinnedTabID: TerminalTabID
    let projectTabID: TerminalTabID
    let projectTabIDs: [TerminalTabID]

    func pinAction(for tabIDs: [TerminalTabID]) -> TerminalSidebarBatchTabMenu.PinAction {
      TerminalSidebarBatchTabMenu(
        terminal: terminal,
        tabIDs: tabIDs,
        contextualTabID: projectTabID,
        renameState: nil
      ).pinAction
    }
  }
}
