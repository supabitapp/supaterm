import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SessionRestoreTests {
    @Test(.timeLimit(.minutes(5)))
    func layoutSelectionSurvivesSocketQuitRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      try await app.waitForDebugSnapshot("the initial pane is available") { snapshot in
        guard let space = snapshot.windows.first?.spaces.first else { return false }
        return space.flattenedTabs.first?.panes.first != nil
      }
      let initialSpace = try #require(try app.debugSnapshot().windows.first?.spaces.first)
      let initialPaneID = try #require(
        initialSpace.flattenedTabs.first?.panes.first?.id
      )
      let firstSpaceName = "layout-a-\(token)"
      let secondSpaceName = "layout-b-\(token)"
      let firstTitle = "layout-a-one-\(token)"
      let secondTitle = "layout-a-two-\(token)"
      let thirdTitle = "layout-b-one-\(token)"

      let firstSpace = try makeSpace(app, name: firstSpaceName)
      _ = try lockTabTitle(app, tabID: firstSpace.tabID, title: firstTitle)
      let secondTab = try makeTab(app, in: firstSpace, cwd: directory)
      _ = try lockTabTitle(app, tabID: secondTab.tabID, title: secondTitle)
      let split = try makeSplit(app, from: secondTab, cwd: directory)
      let secondSpace = try makeSpace(app, name: secondSpaceName)
      _ = try lockTabTitle(app, tabID: secondSpace.tabID, title: thirdTitle)

      try await app.waitForPersistedStateQuiescence(
        containing: [
          firstSpaceName,
          secondSpaceName,
          firstTitle,
          secondTitle,
          thirdTitle,
          firstSpace.paneID.uuidString,
          secondTab.paneID.uuidString,
          split.paneID.uuidString,
          secondSpace.paneID.uuidString,
        ]
      )
      _ = try app.send(
        .focusPane(SupatermPaneTargetRequest(paneID: split.paneID)),
        as: SupatermFocusPaneResult.self
      )
      let before = try app.debugSnapshot()
      try await app.quit()
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the full restored layout is visible") { snapshot in
        let spaces = snapshot.windows.flatMap(\.spaces)
        let paneIDs = Set(spaces.flatMap(\.flattenedTabs).flatMap(\.panes).map(\.id))
        guard
          let window = snapshot.windows.first(where: {
            $0.displayedSpaceID == firstSpace.target.spaceID
          }),
          let selectedSpace = window.spaces.first(where: { $0.id == firstSpace.target.spaceID }),
          let selectedTab = selectedSpace.flattenedTabs.first(where: { $0.id == secondTab.tabID }),
          let focusedPane = selectedTab.panes.first(where: { $0.id == split.paneID })
        else { return false }
        return [
          initialPaneID, firstSpace.paneID, secondTab.paneID, split.paneID, secondSpace.paneID,
        ]
        .allSatisfy { paneIDs.contains($0) }
          && selectedTab.isSelected
          && focusedPane.isFocused
      }

      let after = try app.debugSnapshot()
      #expect(after.summary.windowCount == before.summary.windowCount)
      #expect(after.summary.spaceCount == before.summary.spaceCount)
      #expect(after.summary.tabCount == before.summary.tabCount)
      #expect(after.summary.paneCount == before.summary.paneCount)

      let restoredFirstSpace = try restoredSpace(named: firstSpaceName, in: app)
      let restoredFirstTabs = restoredFirstSpace.flattenedTabs
      #expect(restoredFirstSpace.id == firstSpace.target.spaceID)
      #expect(restoredFirstTabs.map(\.title) == [firstTitle, secondTitle])
      #expect(restoredFirstTabs[0].panes.map(\.id) == [firstSpace.paneID])
      #expect(Set(restoredFirstTabs[1].panes.map(\.id)) == [secondTab.paneID, split.paneID])

      let restoredSecondSpace = try restoredSpace(named: secondSpaceName, in: app)
      let restoredSecondTabs = restoredSecondSpace.flattenedTabs
      #expect(restoredSecondSpace.id == secondSpace.target.spaceID)
      #expect(restoredSecondTabs.map(\.title) == [thirdTitle])
      #expect(restoredSecondTabs[0].panes.map(\.id) == [secondSpace.paneID])

      #expect(
        after.windows.contains { $0.displayedSpaceID == firstSpace.target.spaceID }
      )
      #expect(restoredFirstTabs[1].isSelected)
      let restoredSplit = try #require(restoredFirstTabs[1].panes.first { $0.id == split.paneID })
      #expect(restoredSplit.isFocused)
    }

    @Test(.timeLimit(.minutes(5)))
    func layoutSurvivesSigtermAfterQuiescence() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let spaceName = "sigterm-layout-\(token)"
      let firstTitle = "sigterm-one-\(token)"
      let secondTitle = "sigterm-two-\(token)"
      let space = try makeSpace(app, name: spaceName)
      _ = try lockTabTitle(app, tabID: space.tabID, title: firstTitle)
      let secondTab = try makeTab(app, in: space, cwd: directory)
      _ = try lockTabTitle(app, tabID: secondTab.tabID, title: secondTitle)
      let split = try makeSplit(app, from: secondTab, cwd: directory)

      try await app.waitForPersistedStateQuiescence(
        containing: [
          spaceName,
          firstTitle,
          secondTitle,
          space.paneID.uuidString,
          secondTab.paneID.uuidString,
          split.paneID.uuidString,
        ]
      )
      app.terminate(preservingState: true)
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the sigterm layout is restored") { snapshot in
        let paneIDs = Set(
          snapshot.windows.flatMap(\.spaces).flatMap(\.flattenedTabs).flatMap(\.panes).map(\.id)
        )
        return [space.paneID, secondTab.paneID, split.paneID].allSatisfy { paneIDs.contains($0) }
      }

      let restored = try restoredSpace(named: spaceName, in: app)
      let restoredTabs = restored.flattenedTabs
      #expect(restored.id == space.target.spaceID)
      #expect(restoredTabs.map(\.title) == [firstTitle, secondTitle])
      #expect(restoredTabs[0].panes.map(\.id) == [space.paneID])
      #expect(Set(restoredTabs[1].panes.map(\.id)) == [secondTab.paneID, split.paneID])
    }

    @Test(.timeLimit(.minutes(5)))
    func groupedTopologyAndStableIdentitySurviveSocketQuitRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let fixture = try GroupedTopologyFixture.create(app: app, token: token, directory: directory)
      try await relaunchWithGroupedTopology(app, fixture: fixture)
      try verifyRestoredGroupedTopology(app, fixture: fixture)
      try verifyDurableGroupSurvivesEmptying(app, fixture: fixture)
    }

    @Test(.timeLimit(.minutes(5)))
    func pinnedLockedTabSurvivesSocketQuitRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let space = try makeSpace(app, name: "pin-\(token)")
      let tab = try makeTab(app, in: space, cwd: directory)
      let title = "pinned-\(token)"
      _ = try app.send(
        .renameTab(
          SupatermRenameTabRequest(
            target: SupatermTabTargetRequest(tabID: tab.tabID),
            title: title
          )
        ),
        as: SupatermRenameTabResult.self
      )
      let pinned = try app.send(
        .pinTab(SupatermTabTargetRequest(tabID: tab.tabID)),
        as: SupatermPinTabResult.self
      )
      #expect(pinned.isPinned)
      #expect(try app.debugTab(tab.tabID)?.isSelected == true)

      try await app.waitForPersistedStateQuiescence(containing: [title, tab.paneID.uuidString])
      try await app.quit()
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the pinned tab is restored") { snapshot in
        snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.flattenedTabs)
          .contains { $0.title == title && $0.panes.map(\.id) == [tab.paneID] }
      }

      let restored = try restoredSpace(named: "pin-\(token)", in: app)
      #expect(restored.id == space.target.spaceID)
      let restoredTab = try restoredTab(titled: title, in: restored)
      #expect(e2eRootTab(withID: restoredTab.id, in: restored)?.isPinned == true)
      #expect(restoredTab.isSelected)
      #expect(restoredTab.isTitleLocked)
      #expect(restoredTab.panes.map(\.id) == [tab.paneID])
    }
  }
}

private struct GroupedTopologyFixture {
  let token: String
  let space: SupatermCreateSpaceResult
  let second: SupatermNewTabResult
  let root: SupatermNewTabResult
  let groupID: UUID

  var spaceName: String { Self.spaceName(token) }
  var firstTitle: String { Self.firstTitle(token) }
  var secondTitle: String { Self.secondTitle(token) }
  var rootTitle: String { Self.rootTitle(token) }
  var groupTitle: String { Self.groupTitle(token) }

  static func create(
    app: SupatermE2EApp,
    token: String,
    directory: URL
  ) throws -> Self {
    let space = try makeSpace(app, name: spaceName(token))
    _ = try lockTabTitle(app, tabID: space.tabID, title: firstTitle(token))
    let second = try makeTab(app, in: space, cwd: directory)
    _ = try lockTabTitle(app, tabID: second.tabID, title: secondTitle(token))
    let root = try makeTab(
      app,
      in: space,
      cwd: directory,
      target: .root(space.target.spaceID)
    )
    _ = try lockTabTitle(app, tabID: root.tabID, title: rootTitle(token))
    let group = try app.send(
      .createTabGroup(
        SupatermCreateTabGroupRequest(
          color: .purple,
          isPinned: false,
          target: SupatermSpaceTargetRequest(spaceID: space.target.spaceID),
          title: groupTitle(token)
        )
      ),
      as: SupatermTabGroupMutationResult.self
    )
    for tabID in [space.tabID, second.tabID] {
      _ = try app.send(
        .moveTab(
          SupatermMoveTabRequest(
            destination: .group(group.group.id),
            target: SupatermTabTargetRequest(tabID: tabID)
          )
        ),
        as: SupatermMoveTabResult.self
      )
    }
    _ = try app.send(
      .moveTabGroup(
        SupatermMoveTabGroupRequest(
          index: 1,
          target: SupatermTabGroupTargetRequest(groupID: group.group.id)
        )
      ),
      as: SupatermTabGroupMutationResult.self
    )
    _ = try app.send(
      .collapseTabGroup(SupatermTabGroupTargetRequest(groupID: group.group.id)),
      as: SupatermTabGroupMutationResult.self
    )
    return Self(token: token, space: space, second: second, root: root, groupID: group.group.id)
  }

  private static func spaceName(_ token: String) -> String { "groups-\(token)" }
  private static func firstTitle(_ token: String) -> String { "group-first-\(token)" }
  private static func secondTitle(_ token: String) -> String { "group-second-\(token)" }
  private static func rootTitle(_ token: String) -> String { "group-root-\(token)" }
  private static func groupTitle(_ token: String) -> String { "persisted-group-\(token)" }
}

private func relaunchWithGroupedTopology(
  _ app: SupatermE2EApp,
  fixture: GroupedTopologyFixture
) async throws {
  try await app.waitForPersistedStateQuiescence(
    containing: [
      fixture.groupID.uuidString,
      fixture.space.tabID.uuidString,
      fixture.second.tabID.uuidString,
      fixture.root.tabID.uuidString,
      fixture.groupTitle,
      fixture.firstTitle,
      fixture.secondTitle,
      fixture.rootTitle,
    ]
  )
  try await app.quit()
  try await app.relaunch()
  try await app.waitForDebugSnapshot("the grouped topology is restored") { snapshot in
    guard
      let restored = snapshot.windows.flatMap(\.spaces).first(where: {
        $0.id == fixture.space.target.spaceID
      }),
      restored.flattenedTabs.map(\.id) == [
        fixture.space.tabID, fixture.second.tabID, fixture.root.tabID,
      ]
    else { return false }
    guard case .group(let group) = restored.rootItems.first else { return false }
    return group.id == fixture.groupID && group.isCollapsed
  }
}

private func verifyRestoredGroupedTopology(
  _ app: SupatermE2EApp,
  fixture: GroupedTopologyFixture
) throws {
  let restored = try restoredSpace(named: fixture.spaceName, in: app)
  #expect(restored.rootItems.count == 2)
  guard case .group(let group) = restored.rootItems[0] else {
    Issue.record("Expected the restored group first")
    return
  }
  guard case .tab(let restoredRoot) = restored.rootItems[1] else {
    Issue.record("Expected the restored root tab second")
    return
  }
  #expect(group.id == fixture.groupID)
  #expect(group.title == fixture.groupTitle)
  #expect(group.color == .purple)
  #expect(group.isCollapsed)
  #expect(!group.isPinned)
  #expect(group.tabs.map(\.id) == [fixture.space.tabID, fixture.second.tabID])
  #expect(group.tabs.map(\.title) == [fixture.firstTitle, fixture.secondTitle])
  #expect(group.tabs.map(\.isTitleLocked) == [true, true])
  #expect(restoredRoot.tab.id == fixture.root.tabID)
  #expect(restoredRoot.tab.title == fixture.rootTitle)
  #expect(restoredRoot.tab.isSelected)
  #expect(restoredRoot.tab.isTitleLocked)
}

private func verifyDurableGroupSurvivesEmptying(
  _ app: SupatermE2EApp,
  fixture: GroupedTopologyFixture
) throws {
  for tabID in [fixture.space.tabID, fixture.second.tabID] {
    _ = try app.send(
      .moveTab(
        SupatermMoveTabRequest(
          destination: .root(isPinned: false),
          target: SupatermTabTargetRequest(tabID: tabID)
        )
      ),
      as: SupatermMoveTabResult.self
    )
  }
  let emptied = try restoredSpace(named: fixture.spaceName, in: app)
  let durableItem = emptied.rootItems.first { item in
    guard case .group(let group) = item else { return false }
    return group.id == fixture.groupID
  }
  guard case .group(let durableGroup) = durableItem else {
    Issue.record("Expected the durable group to remain")
    return
  }
  #expect(durableGroup.tabs.isEmpty)
}

private func makeSpace(_ app: SupatermE2EApp, name: String) throws -> SupatermCreateSpaceResult {
  return try app.send(
    .createSpace(SupatermCreateSpaceRequest(color: nil, name: name)),
    as: SupatermCreateSpaceResult.self
  )
}

private func makeTab(
  _ app: SupatermE2EApp,
  in space: SupatermCreateSpaceResult,
  cwd: URL,
  target: SupatermNewTabTarget? = nil,
  startupCommand: SupatermTerminalStartup = hermeticShellStartup
) throws -> SupatermNewTabResult {
  try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: startupCommand,
        cwd: cwd.path,
        focus: true,
        target: target ?? .space(space.target.spaceID)
      )
    ),
    as: SupatermNewTabResult.self
  )
}

private func makeSplit(
  _ app: SupatermE2EApp,
  from tab: SupatermNewTabResult,
  cwd: URL
) throws -> SupatermNewPaneResult {
  try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: hermeticShellStartup,
        cwd: cwd.path,
        direction: .right,
        focus: true,
        equalize: true,
        target: .pane(tab.paneID)
      )
    ),
    as: SupatermNewPaneResult.self
  )
}

@discardableResult
private func lockTabTitle(
  _ app: SupatermE2EApp,
  tabID: UUID,
  title: String
) throws -> SupatermRenameTabResult {
  try app.send(
    .renameTab(
      SupatermRenameTabRequest(
        target: SupatermTabTargetRequest(tabID: tabID),
        title: title
      )
    ),
    as: SupatermRenameTabResult.self
  )
}

private func restoredSpace(
  named name: String,
  in app: SupatermE2EApp
) throws -> SupatermAppDebugSnapshot.Space {
  let spaces = try app.debugSnapshot().windows.flatMap(\.spaces)
  return try #require(spaces.first { $0.name == name && !$0.flattenedTabs.isEmpty })
}

private func restoredTab(
  titled title: String,
  in space: SupatermAppDebugSnapshot.Space
) throws -> SupatermAppDebugSnapshot.Tab {
  try #require(space.flattenedTabs.first { $0.title == title })
}

private func scratchDirectory(_ app: SupatermE2EApp, token: String) throws -> URL {
  let directory = app.stateHome.appendingPathComponent("scratch-\(token)", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  return directory
}

private func token() -> String {
  String(UUID().uuidString.prefix(8).lowercased())
}
