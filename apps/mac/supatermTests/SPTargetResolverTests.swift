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
  func resolveNewTabPlacementPreservesAmbientInheritanceAndExplicitDestinations() throws {
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
        == SupatermNewTabTarget.pane(context.surfaceID)
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
  func resolveMoveTabUsesFlattenedIndexAndPreservesPublicDestinationIndex() throws {
    let request = try resolvePublicMoveTabRequest(
      tab: .path(spaceIndex: 1, tabIndex: 2),
      destination: .group(.title("Work")),
      index: 1,
      isPinned: false,
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
        tab: .path(spaceIndex: 1, tabIndex: 2),
        destination: .group(
          .id(UUID(uuidString: "5C2CCAB6-3BE5-437E-8A70-0C014C45AA23")!)
        ),
        index: nil,
        isPinned: false,
        context: nil,
        snapshot: treeSnapshot()
      )
    }
  }
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
        spaces: firstWindowSpaces
      ),
      SupatermTreeSnapshot.Window(
        index: 2,
        isKey: true,
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
      isSelected: false,
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
      isSelected: false,
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
    isSelected: true,
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
