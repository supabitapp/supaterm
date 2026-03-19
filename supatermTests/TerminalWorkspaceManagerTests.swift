import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalWorkspaceManagerTests {
  @Test
  func restoreFallsBackToDefaultWorkspaceWhenSnapshotMissing() {
    let manager = TerminalWorkspaceManager()

    manager.restore(from: nil)

    #expect(manager.workspaces.map(\.name) == ["A"])
    #expect(manager.selectedWorkspaceID == manager.workspaces.first?.id)
  }

  @Test
  func createWorkspaceUsesNextSpreadsheetLabel() {
    let manager = TerminalWorkspaceManager()
    manager.restore(from: nil)

    _ = manager.createWorkspace()
    _ = manager.createWorkspace()

    #expect(manager.workspaces.map(\.name) == ["A", "B", "C"])
    #expect(manager.selectedWorkspaceID == manager.workspaces.last?.id)
  }

  @Test
  func renameWorkspaceRejectsEmptyAndDuplicateNames() {
    let manager = TerminalWorkspaceManager()
    manager.restore(from: nil)
    let second = manager.createWorkspace()

    #expect(manager.renameWorkspace(second.id, to: "   ") == false)
    #expect(manager.renameWorkspace(second.id, to: "a") == false)
    #expect(manager.renameWorkspace(second.id, to: "Shell") == true)
    #expect(manager.workspaces.map(\.name) == ["A", "Shell"])
  }

  @Test
  func deleteWorkspaceReselectsPreviousWorkspace() {
    let manager = TerminalWorkspaceManager()
    manager.restore(from: nil)
    let second = manager.createWorkspace()
    let third = manager.createWorkspace()

    let deleted = manager.deleteWorkspace(third.id)

    #expect(deleted != nil)
    #expect(manager.workspaces.map(\.name) == ["A", "B"])
    #expect(manager.selectedWorkspaceID == second.id)
  }

  @Test
  func deleteWorkspaceIsRejectedForLastWorkspace() {
    let manager = TerminalWorkspaceManager()
    manager.restore(from: nil)

    let deleted = manager.deleteWorkspace(manager.workspaces[0].id)

    #expect(deleted == nil)
    #expect(manager.workspaces.map(\.name) == ["A"])
  }
}
