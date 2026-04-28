import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTargetResolverTests {
  @Test
  func resolveNewTabTargetUsesUUIDSpaceLocation() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!

    let target = try SPTargetResolver.resolveNewTabTarget(
      window: nil,
      space: .id(spaceID),
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .space(windowIndex: 2, spaceIndex: 1))
  }

  @Test
  func resolvePaneTargetUsesUUIDTabLocation() throws {
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!

    let target = try SPTargetResolver.resolvePaneTarget(
      window: nil,
      space: nil,
      tab: .id(tabID),
      pane: nil,
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .tab(windowIndex: 2, spaceIndex: 1, tabIndex: 2))
  }

  @Test
  func resolvePaneTargetUsesUUIDPaneLocation() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!

    let target = try SPTargetResolver.resolvePaneTarget(
      window: nil,
      space: nil,
      tab: nil,
      pane: .id(paneID),
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .pane(windowIndex: 1, spaceIndex: 2, tabIndex: 1, paneIndex: 2))
  }

  @Test
  func resolvePaneTargetAllowsUUIDSpaceWithNumericChildren() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!

    let target = try SPTargetResolver.resolvePaneTarget(
      window: nil,
      space: .id(spaceID),
      tab: .index(2),
      pane: .index(1),
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .pane(windowIndex: 2, spaceIndex: 1, tabIndex: 2, paneIndex: 1))
  }

  @Test
  func resolvePaneTargetRejectsWindowWithUUIDSpace() {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!

    #expect(throws: ValidationError.self) {
      _ = try SPTargetResolver.resolvePaneTarget(
        window: 1,
        space: .id(spaceID),
        tab: .index(1),
        pane: nil,
        context: nil,
        snapshot: treeSnapshot()
      )
    }
  }

  @Test
  func resolvePaneTargetRejectsUUIDTabWithParentSelectors() {
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!

    #expect(throws: ValidationError.self) {
      _ = try SPTargetResolver.resolvePaneTarget(
        window: nil,
        space: .index(1),
        tab: .id(tabID),
        pane: nil,
        context: nil,
        snapshot: treeSnapshot()
      )
    }
  }

  @Test
  func resolvePaneTargetRejectsUnknownUUID() {
    #expect(throws: ValidationError.self) {
      _ = try SPTargetResolver.resolvePaneTarget(
        window: nil,
        space: nil,
        tab: nil,
        pane: .id(UUID(uuidString: "8A4E58B3-52A0-4343-B013-7493A1A566B7")!),
        context: nil,
        snapshot: treeSnapshot()
      )
    }
  }

  @Test
  func resolvePublicSpaceTargetDefaultsToSelectedSpaceInKeyWindow() throws {
    let target = try resolvePublicSpaceTarget(
      nil,
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .space(windowIndex: 2, spaceIndex: 1))
  }

  @Test
  func resolvePublicPaneTargetDefaultsToFocusedPaneInSelectedTabInKeyWindow() throws {
    let target = try resolvePublicPaneTarget(
      nil,
      context: nil,
      snapshot: treeSnapshot()
    )

    #expect(target == .pane(windowIndex: 2, spaceIndex: 1, tabIndex: 2, paneIndex: 1))
  }
}

private func treeSnapshot() -> SupatermTreeSnapshot {
  let firstSpaceID = UUID(uuidString: "5A8B47F5-9C4E-4F1B-B4AE-251DE331BB78")!
  let secondSpaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
  let firstTabID = UUID(uuidString: "A59BCA89-5C7D-44B7-BB9E-9BC8D29E899A")!
  let secondTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
  let firstPaneID = UUID(uuidString: "F1C6D0CB-D0B7-4E8E-9FF9-E8830E6CE9D0")!
  let secondPaneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
  let thirdPaneID = UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
  let firstWindowFirstTab = SupatermTreeSnapshot.Tab(
    index: 1,
    id: firstTabID,
    title: "shell",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: firstPaneID, isFocused: false)
    ]
  )
  let firstWindowSecondTab = SupatermTreeSnapshot.Tab(
    index: 1,
    id: UUID(uuidString: "067A8941-C553-48C2-B92A-FC258B0260C6")!,
    title: "logs",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: UUID(uuidString: "E66DDF0D-E6FF-456A-A8FB-004D9134A4AF")!, isFocused: false),
      SupatermTreeSnapshot.Pane(index: 2, id: secondPaneID, isFocused: true),
    ]
  )
  let secondWindowFirstTab = SupatermTreeSnapshot.Tab(
    index: 1,
    id: UUID(uuidString: "D9AF1AF2-8B42-484F-88DB-C582B8E9201E")!,
    title: "editor",
    isSelected: false,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: UUID(uuidString: "B7A710CF-1F53-415B-B034-7924FDF6DE24")!, isFocused: false)
    ]
  )
  let secondWindowSecondTab = SupatermTreeSnapshot.Tab(
    index: 2,
    id: secondTabID,
    title: "tests",
    isSelected: true,
    panes: [
      SupatermTreeSnapshot.Pane(index: 1, id: thirdPaneID, isFocused: true)
    ]
  )
  let firstWindowSpaces = [
    SupatermTreeSnapshot.Space(
      index: 1,
      id: firstSpaceID,
      name: "A",
      isSelected: false,
      tabs: [firstWindowFirstTab]
    ),
    SupatermTreeSnapshot.Space(
      index: 2,
      id: UUID(uuidString: "AFD1C31C-60A4-4AC8-8D59-418AD05473EB")!,
      name: "B",
      isSelected: false,
      tabs: [firstWindowSecondTab]
    ),
  ]
  let secondWindowSpace = SupatermTreeSnapshot.Space(
    index: 1,
    id: secondSpaceID,
    name: "C",
    isSelected: true,
    tabs: [secondWindowFirstTab, secondWindowSecondTab]
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
