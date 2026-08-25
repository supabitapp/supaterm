import SupaTheme
import Testing

@testable import supaterm

struct TerminalSidebarProjectOutlineTests {
  @Test
  func projectAndUnassignedSectionsKeepPinnedTabsInsideTheirSection() {
    let project = TerminalProject(name: "Work", color: .blue)
    let projectPinned = TerminalTabItem(
      title: "Project pinned",
      projectID: project.id,
      isPinned: true
    )
    let projectRegular = TerminalTabItem(title: "Project regular", projectID: project.id)
    let unassignedPinned = TerminalTabItem(title: "Unassigned pinned", isPinned: true)
    let unassignedRegular = TerminalTabItem(title: "Unassigned regular")
    let outline = TerminalSidebarOutline(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(),
        collection: TerminalTabCollectionSnapshot(
          pinnedTabs: [unassignedPinned, projectPinned],
          regularTabs: [unassignedRegular, projectRegular],
          selectedTabID: projectPinned.id,
          topologyRevision: 3
        ),
        collapsedProjectIDs: [],
        isUnassignedCollapsed: false
      ),
      projects: [project]
    )

    #expect(
      outline.visibleEntries.map(\.id) == [
        .project(project.id),
        .tab(projectPinned.id),
        .tab(projectRegular.id),
        .unassigned,
        .tab(unassignedPinned.id),
        .tab(unassignedRegular.id),
        .newTab,
      ]
    )
  }

  @Test
  func collapsedUnassignedSectionKeepsItsHeader() {
    let tab = TerminalTabItem(title: "Unassigned")
    let outline = TerminalSidebarOutline(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(),
        collection: TerminalTabCollectionSnapshot(
          pinnedTabs: [],
          regularTabs: [tab],
          selectedTabID: tab.id,
          topologyRevision: 1
        ),
        collapsedProjectIDs: [],
        isUnassignedCollapsed: true
      ),
      projects: []
    )

    #expect(outline.visibleEntries.map(\.id) == [.unassigned, .newTab])
  }

  @Test
  func rowGapAdoptsItsProjectPinLaneWhileHeaderDropPreservesTheLane() throws {
    let project = TerminalProject(name: "Work")
    let pinned = TerminalTabItem(title: "Pinned", projectID: project.id, isPinned: true)
    let regular = TerminalTabItem(title: "Regular", projectID: project.id)
    let source = TerminalTabItem(title: "Source")
    let outline = TerminalSidebarOutline(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(),
        collection: TerminalTabCollectionSnapshot(
          pinnedTabs: [pinned],
          regularTabs: [regular, source],
          selectedTabID: source.id,
          topologyRevision: 4
        ),
        collapsedProjectIDs: [],
        isUnassignedCollapsed: false
      ),
      projects: [project]
    )
    let payload = try #require(outline.dragPayload(for: .tab(source.id)))

    let pinnedGap = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .project(project.id, index: 0),
        outline: outline
      )?.command(for: payload)
    )
    let regularGap = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .project(project.id, index: 1),
        outline: outline
      )?.command(for: payload)
    )
    let header = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootItem(index: 0),
        outline: outline
      )?.command(for: payload)
    )

    #expect(
      pinnedGap.operation
        == .move(TerminalTabPlacement(projectID: project.id, isPinned: true, index: 0))
    )
    #expect(
      regularGap.operation
        == .move(TerminalTabPlacement(projectID: project.id, isPinned: false, index: 0))
    )
    #expect(header.operation == .assign(project.id))
  }
}
