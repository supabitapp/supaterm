import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SessionRestoreTests {
    @Test(.timeLimit(.minutes(5)))
    func layoutSelectionAndOnboardingSurviveSocketQuitRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      try await app.waitForDebugSnapshot("the initial pane is available") { snapshot in
        snapshot.windows.first?.spaces.first?.tabs.first?.panes.first != nil
      }
      let initialPaneID = try #require(
        try app.debugSnapshot().windows.first?.spaces.first?.tabs.first?.panes.first?.id
      )
      let initialPane = SupatermPaneTargetRequest(contextPaneID: initialPaneID)
      try await app.waitForCapture(initialPane, contains: "Welcome to Supaterm!")
      let onboardingOccurrences = countOccurrences(
        "Welcome to Supaterm!",
        in: try app.capture(initialPane, scope: .scrollback)
      )
      let firstSpaceName = "layout-a-\(token)"
      let secondSpaceName = "layout-b-\(token)"
      let firstTitle = "layout-a-one-\(token)"
      let secondTitle = "layout-a-two-\(token)"
      let thirdTitle = "layout-b-one-\(token)"

      let firstSpace = try makeSpace(app, name: firstSpaceName)
      _ = try lockTabTitle(app, paneID: firstSpace.paneID, title: firstTitle)
      let secondTab = try makeTab(app, in: firstSpace, cwd: directory)
      _ = try lockTabTitle(app, paneID: secondTab.paneID, title: secondTitle)
      let split = try makeSplit(app, from: secondTab, cwd: directory)
      let secondSpace = try makeSpace(app, name: secondSpaceName)
      _ = try lockTabTitle(app, paneID: secondSpace.paneID, title: thirdTitle)
      _ = try app.send(
        .focusPane(SupatermPaneTargetRequest(contextPaneID: split.paneID)),
        as: SupatermFocusPaneResult.self
      )
      let before = try app.debugSnapshot()

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
      try await app.quit()
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the full restored layout is visible") { snapshot in
        let paneIDs = Set(snapshot.windows.flatMap(\.spaces).flatMap(\.tabs).flatMap(\.panes).map(\.id))
        return [initialPaneID, firstSpace.paneID, secondTab.paneID, split.paneID, secondSpace.paneID]
          .allSatisfy { paneIDs.contains($0) }
      }

      let after = try app.debugSnapshot()
      #expect(after.summary.windowCount == before.summary.windowCount)
      #expect(after.summary.spaceCount == before.summary.spaceCount)
      #expect(after.summary.tabCount == before.summary.tabCount)
      #expect(after.summary.paneCount == before.summary.paneCount)

      let restoredFirstSpace = try restoredSpace(named: firstSpaceName, in: app)
      #expect(restoredFirstSpace.id == firstSpace.target.spaceID)
      #expect(restoredFirstSpace.tabs.map(\.title) == [firstTitle, secondTitle])
      #expect(restoredFirstSpace.tabs[0].panes.map(\.id) == [firstSpace.paneID])
      #expect(Set(restoredFirstSpace.tabs[1].panes.map(\.id)) == [secondTab.paneID, split.paneID])

      let restoredSecondSpace = try restoredSpace(named: secondSpaceName, in: app)
      #expect(restoredSecondSpace.id == secondSpace.target.spaceID)
      #expect(restoredSecondSpace.tabs.map(\.title) == [thirdTitle])
      #expect(restoredSecondSpace.tabs[0].panes.map(\.id) == [secondSpace.paneID])

      #expect(restoredFirstSpace.isSelected)
      #expect(restoredFirstSpace.tabs[1].isSelected)
      let restoredSplit = try #require(restoredFirstSpace.tabs[1].panes.first { $0.id == split.paneID })
      #expect(restoredSplit.isFocused)

      let restoredOnboarding = try app.capture(initialPane, scope: .scrollback)
      #expect(countOccurrences("Welcome to Supaterm!", in: restoredOnboarding) == onboardingOccurrences)
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
      _ = try lockTabTitle(app, paneID: space.paneID, title: firstTitle)
      let secondTab = try makeTab(app, in: space, cwd: directory)
      _ = try lockTabTitle(app, paneID: secondTab.paneID, title: secondTitle)
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
      app.terminate(preservingZmxSessions: true)
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the sigterm layout is restored") { snapshot in
        let paneIDs = Set(snapshot.windows.flatMap(\.spaces).flatMap(\.tabs).flatMap(\.panes).map(\.id))
        return [space.paneID, secondTab.paneID, split.paneID].allSatisfy { paneIDs.contains($0) }
      }

      let restored = try restoredSpace(named: spaceName, in: app)
      #expect(restored.id == space.target.spaceID)
      #expect(restored.tabs.map(\.title) == [firstTitle, secondTitle])
      #expect(restored.tabs[0].panes.map(\.id) == [space.paneID])
      #expect(Set(restored.tabs[1].panes.map(\.id)) == [secondTab.paneID, split.paneID])
    }

    @Test(.timeLimit(.minutes(5)))
    func scrollbackSurvivesSigtermRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let space = try makeSpace(app, name: "visible-\(token)")
      let marker = "scrollback-\(token)"
      let tab = try makeTab(
        app,
        in: space,
        cwd: directory,
        startupCommand: zshStartupCommand(
          "i=1; while [ $i -le 90 ]; do printf '\(marker)-%03d\\n' $i; i=$((i + 1)); done; exec /bin/zsh -f"
        )
      )
      let pane = SupatermPaneTargetRequest(contextPaneID: tab.paneID)

      try await app.waitForCapture(pane, contains: "\(marker)-090")
      try await app.waitForPersistedStateQuiescence(
        containing: ["visible-\(token)", tab.paneID.uuidString]
      )
      app.terminate(preservingZmxSessions: true)
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the scrollback pane is restored") { snapshot in
        snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.tabs)
          .flatMap(\.panes)
          .contains { $0.id == tab.paneID }
      }

      let scrollback = try app.capture(pane, scope: .scrollback)
      #expect(scrollback.contains("\(marker)-001"))
      #expect(scrollback.contains("\(marker)-090"))
    }

    @Test(.timeLimit(.minutes(5)))
    func foregroundProcessSurvivesSigtermRelaunch() async throws {
      let app = try await SupatermE2EApp.launch()
      defer { app.terminate() }

      let token = token()
      let directory = try scratchDirectory(app, token: token)
      let heartbeat = directory.appendingPathComponent("heartbeat.txt", isDirectory: false)
      let space = try makeSpace(app, name: "process-\(token)")
      let tab = try makeTab(
        app,
        in: space,
        cwd: directory,
        startupCommand: zshStartupCommand(
          "while true; do date +%s%N >> \(SupatermShellCommand.escapedToken(heartbeat.path)); sleep 0.2; done"
        )
      )
      try await app.waitUntil("the heartbeat file has initial writes") {
        lineCount(heartbeat) >= 3
      }
      let beforeQuit = lineCount(heartbeat)

      try await app.waitForPersistedStateQuiescence(
        containing: ["process-\(token)", tab.paneID.uuidString]
      )
      app.terminate(preservingZmxSessions: true)
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the heartbeat pane is restored") { snapshot in
        snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.tabs)
          .flatMap(\.panes)
          .contains { $0.id == tab.paneID }
      }
      try await app.waitUntil("the heartbeat process keeps writing after relaunch") {
        lineCount(heartbeat) > beforeQuit
      }
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
            target: SupatermTabTargetRequest(contextPaneID: tab.paneID),
            title: title
          )
        ),
        as: SupatermRenameTabResult.self
      )
      let pinned = try app.send(
        .pinTab(SupatermTabTargetRequest(contextPaneID: tab.paneID)),
        as: SupatermPinTabResult.self
      )
      #expect(pinned.isPinned)

      try await app.waitForPersistedStateQuiescence(containing: [title, tab.paneID.uuidString])
      try await app.quit()
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the pinned tab is restored") { snapshot in
        snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.tabs)
          .contains { $0.title == title && $0.panes.map(\.id) == [tab.paneID] }
      }

      let restored = try restoredSpace(named: "pin-\(token)", in: app)
      #expect(restored.id == space.target.spaceID)
      let restoredTab = try restoredTab(titled: title, in: restored)
      #expect(restoredTab.isPinned)
      #expect(restoredTab.isTitleLocked)
      #expect(restoredTab.panes.map(\.id) == [tab.paneID])
    }
  }
}

private func zshStartupCommand(_ script: String) -> String {
  "exec /bin/zsh -f -c \(SupatermShellCommand.escapedToken(script))"
}

private func makeSpace(_ app: SupatermE2EApp, name: String) throws -> SupatermCreateSpaceResult {
  let snapshot = try app.debugSnapshot()
  let window = try #require(snapshot.windows.first)
  return try app.send(
    .createSpace(
      SupatermCreateSpaceRequest(
        name: name,
        target: SupatermSpaceNavigationRequest(targetWindowIndex: window.index)
      )
    ),
    as: SupatermCreateSpaceResult.self
  )
}

private func makeTab(
  _ app: SupatermE2EApp,
  in space: SupatermCreateSpaceResult,
  cwd: URL,
  startupCommand: String = hermeticShellStartupCommand
) throws -> SupatermNewTabResult {
  try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: startupCommand,
        cwd: cwd.path,
        focus: true,
        targetWindowIndex: space.target.windowIndex,
        targetSpaceIndex: space.target.spaceIndex
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
        startupCommand: hermeticShellStartupCommand,
        contextPaneID: tab.paneID,
        cwd: cwd.path,
        direction: .right,
        focus: true,
        equalize: true
      )
    ),
    as: SupatermNewPaneResult.self
  )
}

@discardableResult
private func lockTabTitle(
  _ app: SupatermE2EApp,
  paneID: UUID,
  title: String
) throws -> SupatermRenameTabResult {
  try app.send(
    .renameTab(
      SupatermRenameTabRequest(
        target: SupatermTabTargetRequest(contextPaneID: paneID),
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
  return try #require(spaces.first { $0.name == name })
}

private func restoredTab(
  titled title: String,
  in space: SupatermAppDebugSnapshot.Space
) throws -> SupatermAppDebugSnapshot.Tab {
  try #require(space.tabs.first { $0.title == title })
}

private func scratchDirectory(_ app: SupatermE2EApp, token: String) throws -> URL {
  let directory = app.stateHome.appendingPathComponent("scratch-\(token)", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  return directory
}

private func token() -> String {
  String(UUID().uuidString.prefix(8).lowercased())
}

private func lineCount(_ file: URL) -> Int {
  guard let contents = try? String(contentsOf: file, encoding: .utf8) else { return 0 }
  return contents.split(whereSeparator: \.isNewline).count
}

private func countOccurrences(_ needle: String, in haystack: String) -> Int {
  haystack.components(separatedBy: needle).count - 1
}
