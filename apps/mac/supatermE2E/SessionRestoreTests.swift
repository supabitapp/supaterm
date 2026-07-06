import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SessionRestoreTests {
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
