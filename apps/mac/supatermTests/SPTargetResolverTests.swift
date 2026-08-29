import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTargetResolverTests {
  @Test
  func resolvePublicSpaceTargetDefaultsToSelectedSpaceInKeyWindow() throws {
    let target = try resolvePublicSpaceTarget(
      nil,
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(
      target
        == SupatermSpaceTargetRequest(
          spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
        )
    )
  }

  @Test
  func resolvedSpaceRequestContainsOnlyTheStableSpaceID() throws {
    let target = try resolvePublicSpaceTarget(
      nil,
      context: nil,
      snapshot: treeSnapshot()
    )
    let data = try JSONEncoder().encode(target)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])

    #expect(
      object == [
        "spaceID": "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497"
      ]
    )
  }

  @Test
  func resolvePublicSpaceTargetCarriesTheAmbientContext() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "F1C6D0CB-D0B7-4E8E-9FF9-E8830E6CE9D0")!,
      tabID: UUID(uuidString: "A59BCA89-5C7D-44B7-BB9E-9BC8D29E899A")!
    )

    let target = try resolvePublicSpaceTarget(
      .index(2),
      context: context,
      snapshot: treeSnapshot()
    )

    #expect(
      target
        == SupatermSpaceTargetRequest(
          spaceID: UUID(uuidString: "AFD1C31C-60A4-4AC8-8D59-418AD05473EB")!,
          context: context
        )
    )
  }

  @Test
  func resolvePublicSpaceListingReturnsTheAmbientWindow() throws {
    let window = try resolvePublicSpaceListing(context: nil, snapshot: treeSnapshot())

    #expect(window.index == 2)
    #expect(window.displayedSpaceID == UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!)
    #expect(window.spaces.map(\.index) == [1])
  }

  @Test
  func resolvePublicSpaceListingFollowsTheSurfaceContext() throws {
    let window = try resolvePublicSpaceListing(
      context: SupatermCLIContext(
        surfaceID: UUID(uuidString: "F1C6D0CB-D0B7-4E8E-9FF9-E8830E6CE9D0")!,
        tabID: UUID(uuidString: "A59BCA89-5C7D-44B7-BB9E-9BC8D29E899A")!
      ),
      snapshot: treeSnapshot()
    )

    #expect(window.index == 1)
    #expect(window.displayedSpaceID == UUID(uuidString: "5A8B47F5-9C4E-4F1B-B4AE-251DE331BB78")!)
    #expect(window.spaces.map(\.name) == ["A", "B"])
  }

  @Test
  func resolvePublicPaneTargetDefaultsToFocusedPaneInSelectedTabInKeyWindow() throws {
    let target = try resolvePublicPaneTarget(
      nil,
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(
      target
        == SupatermPaneTargetRequest(
          paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
        )
    )
  }

  @Test
  func resolveGroupByUUIDGloballyAndTitleInAmbientSpace() throws {
    let groupID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    )

    #expect(
      try resolvePublicGroupTargetRequest(
        .id(groupID),
        context: nil,
        snapshot: treeSnapshot()
      ) == SupatermTabGroupTargetRequest(groupID: groupID)
    )
    #expect(
      try resolvePublicGroupTargetRequest(
        .title("Work"),
        context: context,
        snapshot: treeSnapshot()
      ) == SupatermTabGroupTargetRequest(groupID: groupID)
    )
    #expect(
      try resolvePublicGroupTargetRequest(
        nil,
        context: context,
        snapshot: treeSnapshot()
      ) == SupatermTabGroupTargetRequest(groupID: groupID)
    )
  }

  @Test
  func resolveGroupRejectsDuplicateTitleInAmbientSpace() {
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicGroupTargetRequest(
        .title("Work"),
        context: nil,
        snapshot: treeSnapshot(hasDuplicateGroupTitle: true)
      )
    }
  }

  @Test
  func resolveNewTabPlacementDefaultsToAmbientGroupAndPreservesExplicitDestinations() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    )

    #expect(
      try resolvePublicNewTabPlacement(
        space: nil,
        group: nil,
        context: context,
        snapshot: treeSnapshot()
      )
        == SupatermNewTabTarget.group(
          UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
        )
    )
    #expect(
      try resolvePublicNewTabPlacement(
        space: nil,
        group: .root,
        context: context,
        snapshot: treeSnapshot()
      )
        == SupatermNewTabTarget.root(
          UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
        )
    )
    #expect(
      try resolvePublicNewTabPlacement(
        space: nil,
        group: .group(.title("Work")),
        context: context,
        snapshot: treeSnapshot()
      )
        == SupatermNewTabTarget.group(
          UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
        )
    )
  }

  @Test
  func resolveNewTabPlacementKeepsAmbientRootTabAtTheRoot() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let tabID = UUID(uuidString: "067A8941-C553-48C2-B92A-FC258B0260C6")!
    let context = SupatermCLIContext(surfaceID: paneID, tabID: tabID)

    #expect(
      try resolvePublicNewTabPlacement(
        space: nil,
        group: nil,
        context: context,
        snapshot: treeSnapshot()
      ) == .pane(paneID)
    )
  }

  @Test
  func resolveNewTabPlacementUsesSelectedGroupWithoutContext() throws {
    #expect(
      try resolvePublicNewTabPlacement(
        space: nil,
        group: nil,
        context: nil,
        snapshot: treeSnapshot()
      ) == .group(UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!)
    )
  }

  @Test
  func resolveMoveTabUsesFlattenedIndexAndPreservesPublicDestinationIndex() throws {
    let request = try resolvePublicMoveTabRequest(
      SPMoveTabResolutionInput(
        tab: .path(spaceIndex: 1, tabIndex: 2),
        destination: .group(.title("Work")),
        index: 1,
        isPinned: false
      ),
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(
      request
        == SupatermMoveTabRequest(
          destination: .group(UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!),
          index: 1,
          target: SupatermTabTargetRequest(
            tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
          )
        )
    )
  }

  @Test
  func resolveMoveTabRejectsGroupInAnotherSpace() {
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicMoveTabRequest(
        SPMoveTabResolutionInput(
          tab: .path(spaceIndex: 1, tabIndex: 2),
          destination: .group(
            .id(UUID(uuidString: "5C2CCAB6-3BE5-437E-8A70-0C014C45AA23")!)
          ),
          index: nil,
          isPinned: false
        ),
        context: nil,
        snapshot: treeSnapshot()
      )
    }
  }

  @Test
  func typedShortRefsResolveToCanonicalTargets() throws {
    let snapshot = treeSnapshot()

    #expect(
      try resolvePublicSpaceTarget(
        .short(SPShortReference(kind: .space, prefix: "a6e57b1b")),
        context: nil,
        snapshot: snapshot
      ).spaceID == UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    )
    #expect(
      try resolvePublicGroupTargetRequest(
        .short(SPShortReference(kind: .group, prefix: "5a52445e")),
        context: nil,
        snapshot: snapshot
      ).groupID == UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
    )
    #expect(
      try resolvePublicTabTarget(
        .short(SPShortReference(kind: .tab, prefix: "6bfc889d")),
        context: nil,
        snapshot: snapshot
      ).tabID == UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    )
    #expect(
      try resolvePublicPaneTarget(
        .short(SPShortReference(kind: .pane, prefix: "8cf762c9")),
        context: nil,
        snapshot: snapshot
      ).paneID == UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )
  }

  @Test
  func sharedSpaceShortRefUsesTheAmbientWindow() throws {
    let snapshot = sharedSpaceSnapshot()
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "D0000000-0000-4000-8000-000000000001")!,
      tabID: UUID(uuidString: "C0000000-0000-4000-8000-000000000001")!
    )
    let space = SPSpaceReference.short(
      SPShortReference(kind: .space, prefix: "a0000000")
    )

    #expect(
      try resolvePublicNewTabPlacement(
        space: space,
        group: .group(.title("Build")),
        context: context,
        snapshot: snapshot
      ) == .group(UUID(uuidString: "B0000000-0000-4000-8000-000000000001")!)
    )
    #expect(
      try resolvePublicNewTabPlacement(
        space: space,
        group: .group(.title("Build")),
        context: nil,
        snapshot: snapshot
      ) == .group(UUID(uuidString: "B0000000-0000-4000-8000-000000000002")!)
    )
  }

  @Test
  func staleAmbientContextDoesNotFallBackToTheKeyWindow() {
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicSpaceTarget(
        .short(SPShortReference(kind: .space, prefix: "a0000000")),
        context: SupatermCLIContext(
          surfaceID: UUID(uuidString: "E0000000-0000-4000-8000-000000000001")!,
          tabID: UUID(uuidString: "F0000000-0000-4000-8000-000000000001")!
        ),
        snapshot: sharedSpaceSnapshot()
      )
    }
  }

  @Test
  func staleAmbientTabContextFollowsMovedPane() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "D0000000-0000-4000-8000-000000000001")!,
      tabID: UUID(uuidString: "C0000000-0000-4000-8000-000000000002")!
    )
    let snapshot = sharedSpaceSnapshot()

    #expect(
      try resolvePublicSpaceTarget(
        nil,
        context: context,
        snapshot: snapshot
      )
        == SupatermSpaceTargetRequest(
          spaceID: UUID(uuidString: "A0000000-0000-4000-8000-000000000001")!,
          context: context
        )
    )
    #expect(
      try resolvePublicPaneTarget(nil, context: context, snapshot: snapshot)
        == SupatermPaneTargetRequest(
          paneID: UUID(uuidString: "D0000000-0000-4000-8000-000000000001")!
        )
    )
    #expect(
      try resolvePublicSplitTarget(nil, context: context, snapshot: snapshot)
        == .pane(UUID(uuidString: "D0000000-0000-4000-8000-000000000001")!)
    )
  }

  @Test
  func sharedSpaceRejectsAGroupFromAnotherWindow() {
    let snapshot = sharedSpaceSnapshot()
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "D0000000-0000-4000-8000-000000000001")!,
      tabID: UUID(uuidString: "C0000000-0000-4000-8000-000000000001")!
    )

    #expect(throws: ValidationError.self) {
      _ = try resolvePublicNewTabPlacement(
        space: .short(SPShortReference(kind: .space, prefix: "a0000000")),
        group: .group(
          .short(SPShortReference(kind: .group, prefix: "b0000000000000000000000000000002"))),
        context: context,
        snapshot: snapshot
      )
    }
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicMoveTabRequest(
        SPMoveTabResolutionInput(
          tab: .short(SPShortReference(kind: .tab, prefix: "c0000000000000000000000000000001")),
          destination: .group(
            .short(
              SPShortReference(kind: .group, prefix: "b0000000000000000000000000000002")
            )
          ),
          index: nil,
          isPinned: false
        ),
        context: context,
        snapshot: snapshot
      )
    }
  }
}

private func sharedSpaceSnapshot() -> SupatermTreeSnapshot {
  let spaceID = UUID(uuidString: "A0000000-0000-4000-8000-000000000001")!
  func window(index: Int, isKey: Bool) -> SupatermTreeSnapshot.Window {
    let suffix = index == 1 ? "1" : "2"
    let groupID = UUID(uuidString: "B0000000-0000-4000-8000-00000000000\(suffix)")!
    let tabID = UUID(uuidString: "C0000000-0000-4000-8000-00000000000\(suffix)")!
    let paneID = UUID(uuidString: "D0000000-0000-4000-8000-00000000000\(suffix)")!
    let tab = SupatermTreeSnapshot.Tab(
      id: tabID,
      title: "shell",
      isSelected: true,
      panes: [SupatermTreeSnapshot.Pane(index: 1, id: paneID, isFocused: true)]
    )
    let group = SupatermTreeSnapshot.Group(
      color: .neutral,
      id: groupID,
      isCollapsed: false,
      isPinned: false,
      title: "Build",
      tabs: [tab]
    )
    return SupatermTreeSnapshot.Window(
      index: index,
      isKey: isKey,
      displayedSpaceID: spaceID,
      spaces: [
        SupatermTreeSnapshot.Space(
          index: 1,
          id: spaceID,
          name: "Work",
          color: .neutral,
          isWarm: true,
          rootItems: [.group(group)]
        )
      ]
    )
  }
  return SupatermTreeSnapshot(
    windows: [
      window(index: 1, isKey: false),
      window(index: 2, isKey: true),
    ]
  )
}

private func treeSnapshot(hasDuplicateGroupTitle: Bool = false) -> SupatermTreeSnapshot {
  let firstSpaceID = UUID(uuidString: "5A8B47F5-9C4E-4F1B-B4AE-251DE331BB78")!
  let secondSpaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
  let firstTabID = UUID(uuidString: "A59BCA89-5C7D-44B7-BB9E-9BC8D29E899A")!
  let secondTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
  let firstPaneID = UUID(uuidString: "F1C6D0CB-D0B7-4E8E-9FF9-E8830E6CE9D0")!
  let secondPaneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
  let thirdPaneID = UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
  let firstWindowFirstTab = SupatermTreeSnapshot.Tab(
    id: firstTabID,
    title: "shell",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: firstPaneID, isFocused: false)
    ]
  )
  let firstWindowSecondTab = SupatermTreeSnapshot.Tab(
    id: UUID(uuidString: "067A8941-C553-48C2-B92A-FC258B0260C6")!,
    title: "logs",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(
        index: 1,
        id: UUID(uuidString: "E66DDF0D-E6FF-456A-A8FB-004D9134A4AF")!,
        isFocused: false
      ),
      SupatermTreeSnapshot.Pane(index: 2, id: secondPaneID, isFocused: true),
    ]
  )
  let secondWindowFirstTab = SupatermTreeSnapshot.Tab(
    id: UUID(uuidString: "D9AF1AF2-8B42-484F-88DB-C582B8E9201E")!,
    title: "editor",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(
        index: 1,
        id: UUID(uuidString: "B7A710CF-1F53-415B-B034-7924FDF6DE24")!,
        isFocused: false
      )
    ]
  )
  let secondWindowSecondTab = SupatermTreeSnapshot.Tab(
    id: secondTabID,
    title: "tests",
    isSelected: true,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: thirdPaneID, isFocused: true)
    ]
  )
  let firstWindowSpaces = targetResolverFirstWindowSpaces(
    firstSpaceID: firstSpaceID,
    firstTab: firstWindowFirstTab,
    secondTab: firstWindowSecondTab
  )
  let secondWindowSpace = targetResolverSecondWindowSpace(
    id: secondSpaceID,
    firstTab: secondWindowFirstTab,
    secondTab: secondWindowSecondTab,
    hasDuplicateGroupTitle: hasDuplicateGroupTitle
  )
  let secondWindowSpaces = [secondWindowSpace]

  return SupatermTreeSnapshot(
    windows: [
      SupatermTreeSnapshot.Window(
        index: 1,
        isKey: false,
        displayedSpaceID: firstSpaceID,
        spaces: firstWindowSpaces
      ),
      SupatermTreeSnapshot.Window(
        index: 2,
        isKey: true,
        displayedSpaceID: secondWindowSpace.id,
        spaces: secondWindowSpaces
      ),
    ]
  )
}

private func targetResolverFirstWindowSpaces(
  firstSpaceID: UUID,
  firstTab: SupatermTreeSnapshot.Tab,
  secondTab: SupatermTreeSnapshot.Tab
) -> [SupatermTreeSnapshot.Space] {
  [
    SupatermTreeSnapshot.Space(
      index: 1,
      id: firstSpaceID,
      name: "A",
      color: .neutral,
      isWarm: true,
      rootItems: [
        .group(
          SupatermTreeSnapshot.Group(
            color: .neutral,
            id: UUID(uuidString: "5C2CCAB6-3BE5-437E-8A70-0C014C45AA23")!,
            isCollapsed: false,
            isPinned: false,
            title: "Remote",
            tabs: [firstTab]
          )
        )
      ]
    ),
    SupatermTreeSnapshot.Space(
      index: 2,
      id: UUID(uuidString: "AFD1C31C-60A4-4AC8-8D59-418AD05473EB")!,
      name: "B",
      color: .neutral,
      isWarm: true,
      rootItems: [.tab(SupatermTreeSnapshot.RootTab(isPinned: false, tab: secondTab))]
    ),
  ]
}

private func targetResolverSecondWindowSpace(
  id: UUID,
  firstTab: SupatermTreeSnapshot.Tab,
  secondTab: SupatermTreeSnapshot.Tab,
  hasDuplicateGroupTitle: Bool
) -> SupatermTreeSnapshot.Space {
  let duplicateGroups: [SupatermTreeSnapshot.RootItem] =
    hasDuplicateGroupTitle
    ? [
      .group(
        SupatermTreeSnapshot.Group(
          color: .red,
          id: UUID(uuidString: "AD777E81-B111-4239-B2B1-7848C3D496D5")!,
          isCollapsed: false,
          isPinned: false,
          title: "Work",
          tabs: []
        )
      )
    ] : []

  return SupatermTreeSnapshot.Space(
    index: 1,
    id: id,
    name: "C",
    color: .neutral,
    isWarm: true,
    rootItems: [
      .tab(SupatermTreeSnapshot.RootTab(isPinned: false, tab: firstTab)),
      .group(
        SupatermTreeSnapshot.Group(
          color: .blue,
          id: UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!,
          isCollapsed: true,
          isPinned: false,
          title: "Work",
          tabs: [secondTab]
        )
      ),
    ] + duplicateGroups
  )
}
