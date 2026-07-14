import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTargetResolverTests {
  private let windowID = UUID(uuidString: "B0000000-0000-0000-0000-000000000000")!
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
        == SPResolvedProjectTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1)
    )
    #expect(
      try resolvePublicTabTarget(.id(tabID), context: nil, snapshot: snapshot)
        == SPResolvedTabTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1)
    )
    #expect(
      try resolvePublicPaneTarget(.id(paneID), context: nil, snapshot: snapshot)
        == SPResolvedPaneOnlyTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1, paneIndex: 1)
    )
  }

  @Test
  func contextCreatesTabInCurrentProjectWithExplicitIndexes() throws {
    let context = SupatermCLIContext(windowID: windowID, surfaceID: paneID, tabID: tabID)
    #expect(
      try resolvePublicNewTabTarget(nil, context: context, snapshot: treeSnapshot())
        == SPResolvedNewTabTarget(
          windowIndex: 2,
          spaceIndex: 1,
          projectIndex: 1,
          inheritingFromPaneID: paneID
        )
    )
  }

  @Test
  func explicitProjectDoesNotInheritAmbientPane() throws {
    let context = SupatermCLIContext(windowID: windowID, surfaceID: paneID, tabID: tabID)

    #expect(
      try resolvePublicNewTabTarget(
        .path(spaceIndex: 1, projectIndex: 1),
        context: context,
        snapshot: treeSnapshot()
      )
        == SPResolvedNewTabTarget(
          windowIndex: 2,
          spaceIndex: 1,
          projectIndex: 1,
          inheritingFromPaneID: nil
        )
    )
  }

  @Test
  func ambientContextResolvesEveryPublicTargetToExplicitIndexes() throws {
    let context = SupatermCLIContext(windowID: windowID, surfaceID: paneID, tabID: tabID)
    let snapshot = treeSnapshot()

    #expect(
      try resolvePublicSpaceTarget(nil, context: context, snapshot: snapshot)
        == SPResolvedSpaceTarget(windowIndex: 2, spaceIndex: 1)
    )
    #expect(
      try resolvePublicProjectTarget(nil, context: context, snapshot: snapshot)
        == SPResolvedProjectTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1)
    )
    #expect(
      try resolvePublicTabTarget(nil, context: context, snapshot: snapshot)
        == SPResolvedTabTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1)
    )
    #expect(
      try resolvePublicPaneTarget(nil, context: context, snapshot: snapshot)
        == SPResolvedPaneOnlyTarget(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1, paneIndex: 1)
    )
    #expect(
      try resolvePublicSplitTarget(nil, context: context, snapshot: snapshot)
        == .pane(windowIndex: 2, spaceIndex: 1, projectIndex: 1, tabIndex: 1, paneIndex: 1)
    )
    #expect(
      try resolvePublicSpaceNavigationRequest(context: context, snapshot: snapshot)
        == SupatermSpaceNavigationRequest(targetWindowIndex: 2)
    )
    #expect(
      try resolvePublicTabNavigationRequest(nil, context: context, snapshot: snapshot)
        == SupatermTabNavigationRequest(targetWindowIndex: 2, targetSpaceIndex: 1)
    )
  }

  @Test
  func sharedProjectUUIDResolvesInsideTheContextWindow() throws {
    let firstWindowID = UUID(uuidString: "B0000000-0000-0000-0000-000000000001")!
    let secondWindowID = UUID(uuidString: "B0000000-0000-0000-0000-000000000002")!
    let snapshot = SupatermTreeSnapshot(
      windows: [
        projectWindow(index: 1, id: firstWindowID, isKey: false),
        projectWindow(index: 2, id: secondWindowID, isKey: true),
      ]
    )
    let context = SupatermCLIContext(windowID: firstWindowID, surfaceID: paneID, tabID: tabID)

    #expect(
      try resolvePublicProjectTarget(.id(projectID), context: context, snapshot: snapshot)
        == SPResolvedProjectTarget(windowIndex: 1, spaceIndex: 1, projectIndex: 1)
    )
  }

  private func treeSnapshot() -> SupatermTreeSnapshot {
    SupatermTreeSnapshot(
      windows: [
        SupatermTreeSnapshot.Window(
          index: 2,
          id: windowID,
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
                  directoryURL: URL(fileURLWithPath: "/code/Project", isDirectory: true),
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

  private func projectWindow(index: Int, id: UUID, isKey: Bool) -> SupatermTreeSnapshot.Window {
    SupatermTreeSnapshot.Window(
      index: index,
      id: id,
      isKey: isKey,
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
              directoryURL: URL(fileURLWithPath: "/code/Project", isDirectory: true),
              isPinned: false,
              tabs: []
            )
          ]
        )
      ]
    )
  }
}
