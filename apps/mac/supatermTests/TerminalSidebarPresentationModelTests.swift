import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarPresentationModelTests {
  private let firstProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
  private let secondProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
  private let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!)
  private let secondTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!)
  private let thirdTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000003")!)

  @Test
  func collapsedProjectsHideOnlyTheirTabsWithoutChangingSourceEntries() {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      tab(secondTabID, projectID: firstProjectID),
      project(secondProjectID),
      tab(thirdTabID, projectID: secondProjectID),
      newProject,
    ]
    let model = TerminalSidebarPresentationModel(
      entries: entries,
      collapsedProjectIDs: [firstProjectID]
    )

    #expect(model.entries == entries)
    #expect(
      model.visibleEntries.map(\.id) == [
        .project(firstProjectID),
        .project(secondProjectID),
        .tab(thirdTabID),
        .newProject,
      ])
  }

  private var newProject: TerminalSidebarEntry {
    TerminalSidebarEntry(kind: .newProject)
  }

  private func project(
    _ id: TerminalProjectID,
    isPinned: Bool = false
  ) -> TerminalSidebarEntry {
    TerminalSidebarEntry(kind: .project(id: id, isPinned: isPinned))
  }

  private func tab(
    _ id: TerminalTabID,
    projectID: TerminalProjectID,
    isPinned: Bool = false
  ) -> TerminalSidebarEntry {
    TerminalSidebarEntry(
      kind: .tab(id: id, projectID: projectID, isPinned: isPinned)
    )
  }
}
