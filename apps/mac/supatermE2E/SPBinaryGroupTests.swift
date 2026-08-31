import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite.SPBinaryTests {
  @Test(.timeLimit(.minutes(5)))
  func groupCommandsMutateStructuralSocketTree() async throws {
    try await withTestSpace { app, space in
      let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
      try exerciseGroupCommands(app: app, space: space, runner: runner)
    }
  }
}

private func exerciseGroupCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let groupID = try configureGroup(app: app, space: space, runner: runner)
  try exerciseGroupedTabs(groupID: groupID, app: app, space: space, runner: runner)
}

private func configureGroup(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws -> UUID {
  let created: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "new", "Work", "--color", "blue", "--in", space.spaceID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let groupID = created.group.id
  let groupRef = try listedRef(
    .group,
    id: groupID,
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(created.group.color == .blue)
  #expect(!created.group.isPinned)

  let renamed: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "rename", "Build", groupRef],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(renamed.group.title == "Build")

  let colored: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "color", "purple", groupRef],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(colored.group.color == .purple)

  let pinned: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "pin", groupID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(pinned.group.isPinned)

  let unpinned: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "unpin", groupID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(!unpinned.group.isPinned)

  _ =
    try runSPJSON(
      ["tab", "pin", space.tab.tabID.uuidString],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermPinTabResult
  _ =
    try runSPJSON(
      ["group", "pin", groupID.uuidString],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermTabGroupMutationResult
  _ =
    try runSPJSON(
      ["group", "move", groupID.uuidString, "--index", "1"],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermTabGroupMutationResult
  let reorderedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let reorderedSpace = try #require(
    reorderedTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID }
  )
  #expect(reorderedSpace.rootItems.first.flatMap(groupValue)?.id == groupID)

  let collapsed: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "collapse", groupID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(collapsed.group.isCollapsed)

  let expanded: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "expand", groupID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(!expanded.group.isCollapsed)
  return groupID
}

private func exerciseGroupedTabs(
  groupID: UUID,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let tab: SupatermNewTabResult = try runSPJSON(
    [
      "tab", "new", "--group", groupID.uuidString, "--in", space.spaceID.uuidString,
    ],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let movedIntoGroup: SupatermMoveTabResult = try runSPJSON(
    [
      "tab", "move", space.tab.tabID.uuidString, "--group", groupID.uuidString,
      "--index", "1",
    ],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(movedIntoGroup.target.tabID == space.tab.tabID)
  let groupedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let groupedSpace = try #require(
    groupedTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID }
  )
  let group = try #require(groupedSpace.rootItems.compactMap(groupValue).first { $0.id == groupID })
  #expect(group.title == "Build")
  #expect(group.color == .purple)
  #expect(group.isPinned)
  #expect(!group.isCollapsed)
  #expect(group.tabs.map(\.id) == [space.tab.tabID, tab.tabID])

  let moved: SupatermMoveTabResult = try runSPJSON(
    ["tab", "move", tab.tabID.uuidString, "--root", "--pin", "--index", "1"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(moved.target.tabID == tab.tabID)
  let movedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let movedSpace = try #require(
    movedTree.windows.flatMap(\.spaces).first { $0.id == space.spaceID })
  #expect(
    movedSpace.rootItems.contains {
      guard case .tab(let rootTab) = $0 else { return false }
      return rootTab.tab.id == tab.tabID && rootTab.isPinned
    }
  )
  #expect(
    movedSpace.rootItems.compactMap(groupValue).first { $0.id == groupID }?.tabs.map(\.id)
      == [space.tab.tabID]
  )

  let ungrouped: SupatermRemoveTabGroupResult = try runSPJSON(
    ["group", "ungroup", groupID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(ungrouped.removedGroupID == groupID)
  let ungroupedTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  #expect(
    ungroupedTree.windows.flatMap(\.spaces).flatMap(\.rootItems).compactMap(groupValue)
      .contains { $0.id == groupID } == false
  )

  let closeGroup: SupatermTabGroupMutationResult = try runSPJSON(
    ["group", "new", "Close Me", "--in", space.spaceID.uuidString],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let closeTab: SupatermNewTabResult = try runSPJSON(
    [
      "tab", "new", "--group", closeGroup.group.id.uuidString,
    ],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  let removed: SupatermRemoveTabGroupResult = try runSPJSON(
    ["group", "close", closeGroup.group.id.uuidString, "--yes"],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(removed.removedGroupID == closeGroup.group.id)
  let finalTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  #expect(
    finalTree.windows.flatMap(\.spaces).flatMap(\.rootItems).compactMap(groupValue)
      .contains { $0.id == closeGroup.group.id } == false
  )
  #expect(
    finalTree.windows.flatMap(\.spaces).flatMap(\.flattenedTabs)
      .contains { $0.id == closeTab.tabID } == false
  )
}

private func groupValue(
  _ item: SupatermTreeSnapshot.RootItem
) -> SupatermTreeSnapshot.Group? {
  guard case .group(let group) = item else { return nil }
  return group
}
