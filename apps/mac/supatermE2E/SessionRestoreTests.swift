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
    func projectAssignmentsAndStableIdentitySurviveSocketQuitRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let fixture = try ProjectTopologyFixture.create(app: app, token: token, directory: directory)
      try await relaunchWithProjectTopology(app, fixture: fixture)
      try verifyRestoredProjectTopology(app, fixture: fixture)
      try verifyProjectSurvivesEmptying(app, fixture: fixture)
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
      #expect(restoredTab.isPinned)
      #expect(restoredTab.isSelected)
      #expect(restoredTab.isTitleLocked)
      #expect(restoredTab.panes.map(\.id) == [tab.paneID])
    }
  }
}

private struct ProjectTopologyFixture {
  let token: String
  let space: SupatermCreateSpaceResult
  let second: SupatermNewTabResult
  let unassigned: SupatermNewTabResult
  let projectID: UUID

  var spaceName: String { Self.spaceName(token) }
  var firstTitle: String { Self.firstTitle(token) }
  var secondTitle: String { Self.secondTitle(token) }
  var unassignedTitle: String { Self.unassignedTitle(token) }
  var projectName: String { Self.projectName(token) }

  static func create(
    app: SupatermE2EApp,
    token: String,
    directory: URL
  ) throws -> Self {
    let space = try makeSpace(app, name: spaceName(token))
    _ = try lockTabTitle(app, tabID: space.tabID, title: firstTitle(token))
    let second = try makeTab(app, in: space, cwd: directory)
    _ = try lockTabTitle(app, tabID: second.tabID, title: secondTitle(token))
    let unassigned = try makeTab(app, in: space, cwd: directory)
    _ = try lockTabTitle(app, tabID: unassigned.tabID, title: unassignedTitle(token))
    let project = try app.send(
      .addProject(
        SupatermAddProjectRequest(
          color: .purple,
          isPinned: false,
          name: projectName(token),
          rootPath: directory.path
        )
      ),
      as: SupatermProjectMutationResult.self
    )
    for (tabID, isPinned) in [(space.tabID, true), (second.tabID, false)] {
      _ = try app.send(
        .moveTab(
          SupatermMoveTabRequest(
            isPinned: isPinned,
            projectID: project.project.id,
            target: SupatermTabTargetRequest(tabID: tabID)
          )
        ),
        as: SupatermMoveTabResult.self
      )
    }
    _ = try app.send(
      .setProjectCollapsed(
        SupatermSetProjectCollapsedRequest(
          isCollapsed: true,
          projectID: project.project.id,
          spaceID: space.target.spaceID
        )
      ),
      as: SupatermSetProjectCollapsedResult.self
    )
    return Self(
      token: token,
      space: space,
      second: second,
      unassigned: unassigned,
      projectID: project.project.id
    )
  }

  private static func spaceName(_ token: String) -> String { "projects-\(token)" }
  private static func firstTitle(_ token: String) -> String { "project-first-\(token)" }
  private static func secondTitle(_ token: String) -> String { "project-second-\(token)" }
  private static func unassignedTitle(_ token: String) -> String { "unassigned-\(token)" }
  private static func projectName(_ token: String) -> String { "persisted-project-\(token)" }
}

private func relaunchWithProjectTopology(
  _ app: SupatermE2EApp,
  fixture: ProjectTopologyFixture
) async throws {
  try await app.waitForPersistedStateQuiescence(
    containing: [
      fixture.projectID.uuidString,
      fixture.space.tabID.uuidString,
      fixture.second.tabID.uuidString,
      fixture.unassigned.tabID.uuidString,
      fixture.projectName,
      fixture.firstTitle,
      fixture.secondTitle,
      fixture.unassignedTitle,
    ]
  )
  try await app.quit()
  try await app.relaunch()
  try await app.waitForDebugSnapshot("the Project topology is restored") { snapshot in
    guard
      snapshot.projects.contains(where: { $0.id == fixture.projectID }),
      let restored = snapshot.windows.flatMap(\.spaces).first(where: {
        $0.id == fixture.space.target.spaceID
      }),
      restored.flattenedTabs.map(\.id) == [
        fixture.space.tabID, fixture.second.tabID, fixture.unassigned.tabID,
      ]
    else { return false }
    return restored.collapsedProjectIDs.contains(fixture.projectID)
  }
}

private func verifyRestoredProjectTopology(
  _ app: SupatermE2EApp,
  fixture: ProjectTopologyFixture
) throws {
  let snapshot = try app.debugSnapshot()
  let project = try #require(snapshot.projects.first { $0.id == fixture.projectID })
  let restored = try restoredSpace(named: fixture.spaceName, in: app)
  #expect(project.name == fixture.projectName)
  #expect(project.color == .purple)
  #expect(project.rootPath?.hasSuffix("scratch-\(fixture.token)") == true)
  #expect(!project.isPinned)
  #expect(restored.collapsedProjectIDs == [fixture.projectID])
  #expect(
    restored.flattenedTabs.map(\.id) == [
      fixture.space.tabID, fixture.second.tabID, fixture.unassigned.tabID,
    ])
  #expect(
    restored.flattenedTabs.map(\.projectID) == [
      fixture.projectID, fixture.projectID, nil,
    ])
  #expect(restored.flattenedTabs.map(\.isPinned) == [true, false, false])
  #expect(
    restored.flattenedTabs.map(\.title) == [
      fixture.firstTitle, fixture.secondTitle, fixture.unassignedTitle,
    ])
  #expect(restored.flattenedTabs.map(\.isTitleLocked) == [true, true, true])
  #expect(restored.flattenedTabs.last?.isSelected == true)
}

private func verifyProjectSurvivesEmptying(
  _ app: SupatermE2EApp,
  fixture: ProjectTopologyFixture
) throws {
  for tabID in [fixture.space.tabID, fixture.second.tabID] {
    _ = try app.send(
      .moveTab(
        SupatermMoveTabRequest(
          isPinned: false,
          projectID: nil,
          target: SupatermTabTargetRequest(tabID: tabID)
        )
      ),
      as: SupatermMoveTabResult.self
    )
  }
  let snapshot = try app.debugSnapshot()
  #expect(snapshot.projects.contains { $0.id == fixture.projectID })
  let emptied = try #require(
    snapshot.windows.flatMap(\.spaces).first { $0.id == fixture.space.target.spaceID }
  )
  #expect(emptied.flattenedTabs.allSatisfy { $0.projectID == nil })
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
  startupCommand: SupatermTerminalStartup = hermeticShellStartup
) throws -> SupatermNewTabResult {
  try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: startupCommand,
        cwd: cwd.path,
        focus: true,
        target: .space(space.target.spaceID)
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
