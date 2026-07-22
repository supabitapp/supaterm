import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct TerminalSignalTests {
    @Test(.timeLimit(.minutes(5)))
    func bellUpdatesDebugSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let focusedPane = try makeSplit(app, in: space)
        try await app.waitForShellPrompt(
          SupatermPaneTargetRequest(paneID: focusedPane.paneID)
        )
        try await app.waitUntil("the source pane loses focus") {
          try app.debugPane(space.tab.paneID)?.isFocused == false
        }
        let before = try #require(try app.debugPane(space.tab.paneID))

        try app.type("printf '\\a'\n", into: space.pane)

        try await app.waitUntil("the bell count increases") {
          guard let pane = try app.debugPane(space.tab.paneID) else { return false }
          return pane.bellCount > before.bellCount
        }
        let tab = try #require(try app.debugTab(space.tab.tabID))
        #expect(tab.hasBell)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func progressReportUpdatesDebugSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)

        try app.type("printf '\\033]9;4;1;37\\007'\n", into: space.pane)

        try await app.waitUntil("the progress report is captured") {
          guard let pane = try app.debugPane(space.tab.paneID) else { return false }
          return pane.progressState == "set" && pane.progressValue == 37 && pane.isRunning
        }
        try app.type("printf '\\033]9;4;0\\007'\n", into: space.pane)
        try await app.waitUntil("the progress report is cleared") {
          guard let pane = try app.debugPane(space.tab.paneID) else { return false }
          return pane.progressState == nil && pane.progressValue == nil && !pane.isRunning
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func pwdUpdatesDebugSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let directory = space.directory.appendingPathComponent("pwd-\(space.token)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        try app.type("printf '\\033]7;file://localhost\(directory.path)\\007'\n", into: space.pane)

        try await app.waitUntil("the working directory is captured") {
          try app.debugPane(space.tab.paneID)?.pwd == directory.path
        }
      }
    }
  }
}
