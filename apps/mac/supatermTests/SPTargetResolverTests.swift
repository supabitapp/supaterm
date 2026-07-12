import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTargetResolverTests {
  private let projectID = UUID(uuidString: "B1111111-1111-1111-1111-111111111111")!
  private let tabID = UUID(uuidString: "B2222222-2222-2222-2222-222222222222")!
  private let paneID = UUID(uuidString: "B3333333-3333-3333-3333-333333333333")!

  @Test
  func projectPathParses() throws {
    #expect(try SPProjectReference.parse("2/3") == .path(spaceIndex: 2, projectIndex: 3))
  }

  @Test
  func tabAndPanePathsRequireProjectComponent() throws {
    #expect(
      try SPTabReference.parse("1/2/3")
        == .path(spaceIndex: 1, projectIndex: 2, tabIndex: 3)
    )
    #expect(
      try SPPaneReference.parse("1/2/3/4")
        == .path(spaceIndex: 1, projectIndex: 2, tabIndex: 3, paneIndex: 4)
    )
  }

  @Test
  func UUIDTargetsResolveNestedLocations() throws {
    let snapshot = treeSnapshot()
    #expect(
      try resolvePublicProjectTarget(.id(projectID), context: nil, snapshot: snapshot)
        == .project(windowIndex: 2, spaceIndex: 1, projectIndex: 1)
    )
    #expect(
      try resolvePublicTabTarget(.id(tabID), context: nil, snapshot: snapshot)
        == .tab(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1)
    )
    #expect(
      try resolvePublicPaneTarget(.id(paneID), context: nil, snapshot: snapshot)
        == .pane(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1, paneIndex: 1)
    )
  }

  @Test
  func contextCreatesTabInCurrentProject() throws {
    let context = SupatermCLIContext(surfaceID: paneID, tabID: tabID)
    #expect(
      try resolvePublicNewTabTarget(nil, context: context, snapshot: treeSnapshot())
        == .context(paneID)
    )
  }

  private func treeSnapshot() -> SupatermTreeSnapshot {
    SupatermTreeSnapshot(
      windows: [
        SupatermTreeSnapshot.Window(
          index: 2,
          isKey: true,
          spaces: [
            SupatermTreeSnapshot.Space(
              index: 1,
              id: UUID(),
              name: "Space",
              isSelected: true,
              projects: [
                SupatermTreeSnapshot.Project(
                  index: 1,
                  id: projectID,
                  name: "Project",
                  isPinned: false,
                  tabs: [
                    SupatermTreeSnapshot.Tab(
                      index: 1,
                      id: tabID,
                      title: "Tab",
                      isSelected: true,
                      panes: [SupatermTreeSnapshot.Pane(index: 1, id: paneID, isFocused: true)]
                    )
                  ]
                )
              ]
            )
          ]
        )
      ]
    )
  }
}
