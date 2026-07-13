import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarPresentationModelTests {
  private let firstProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
  private let secondProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
  private let thirdProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!)
  private let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!)
  private let secondTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!)
  private let thirdTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000003")!)
  private let fourthTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000004")!)
  private let fifthTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000005")!)

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

  @Test
  func projectPathsCountWithinTheirPinLane() {
    let model = TerminalSidebarPresentationModel(
      entries: [
        project(firstProjectID, isPinned: true),
        project(secondProjectID),
        project(thirdProjectID, isPinned: true),
        newProject,
      ],
      collapsedProjectIDs: []
    )

    #expect(model.semanticPathByEntryID[.project(firstProjectID)] == .project(isPinned: true, laneIndex: 0))
    #expect(model.semanticPathByEntryID[.project(secondProjectID)] == .project(isPinned: false, laneIndex: 0))
    #expect(model.semanticPathByEntryID[.project(thirdProjectID)] == .project(isPinned: true, laneIndex: 1))
    #expect(model.semanticPathByEntryID[.newProject] == nil)
  }

  @Test
  func tabPathsCountWithinEachProjectsPinLanes() {
    let model = TerminalSidebarPresentationModel(
      entries: [
        project(firstProjectID),
        tab(firstTabID, projectID: firstProjectID, isPinned: true),
        tab(secondTabID, projectID: firstProjectID),
        tab(thirdTabID, projectID: firstProjectID, isPinned: true),
        project(secondProjectID),
        tab(fourthTabID, projectID: secondProjectID),
        tab(fifthTabID, projectID: secondProjectID, isPinned: true),
        newProject,
      ],
      collapsedProjectIDs: []
    )

    #expect(
      model.semanticPathByEntryID[.tab(firstTabID)] == .tab(projectID: firstProjectID, isPinned: true, laneIndex: 0))
    #expect(
      model.semanticPathByEntryID[.tab(secondTabID)] == .tab(projectID: firstProjectID, isPinned: false, laneIndex: 0))
    #expect(
      model.semanticPathByEntryID[.tab(thirdTabID)] == .tab(projectID: firstProjectID, isPinned: true, laneIndex: 1))
    #expect(
      model.semanticPathByEntryID[.tab(fourthTabID)] == .tab(projectID: secondProjectID, isPinned: false, laneIndex: 0))
    #expect(
      model.semanticPathByEntryID[.tab(fifthTabID)] == .tab(projectID: secondProjectID, isPinned: true, laneIndex: 0))
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
