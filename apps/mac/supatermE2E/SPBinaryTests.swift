import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SPBinaryTests {
    @Test(.timeLimit(.minutes(5)))
    func runInjectsSupatermAndTmuxEnvironment() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let result = try requireSuccessfulSPResult(
          try runner.run(
            ["run", "--socket", app.socketPath, "--", "/usr/bin/env"],
            cwd: space.directory
          )
        )
        let environment = parseEnvironment(result.stdout)

        #expect(environment[SupatermCLIEnvironment.socketPathKey] == app.socketPath)
        #expect(environment[SupatermCLIEnvironment.surfaceIDKey] == space.tab.paneID.uuidString)
        #expect(environment[SupatermCLIEnvironment.tabIDKey] == space.tab.tabID.uuidString)
        #expect(environment["TERM_PROGRAM"] == "ghostty")
        #expect(environment["TMUX_PANE"] == "%\(space.tab.paneID.uuidString.lowercased())")
        #expect(environment["TMUX"]?.contains(space.spaceID.uuidString.lowercased()) == true)
        #expect(environment["PATH"]?.contains(".supaterm/tmux/shims") == true)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func tmuxCompatibilityCommandsUseTheLiveSocketTree() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let split = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "split-window", "-h", "-P", "-F",
              "#{pane_id}",
            ],
            cwd: space.directory
          )
        )
        let splitPaneID = try tmuxPaneID(split.stdout)
        let splitPane = SupatermPaneTargetRequest(contextPaneID: splitPaneID)
        try await app.waitForShellPrompt(splitPane)

        let panes = try requireSuccessfulSPResult(
          try runner.run(
            ["tmux", "--socket", app.socketPath, "--", "list-panes", "-F", "#{pane_id}"],
            cwd: space.directory
          )
        )
        #expect(
          Set(outputLines(panes.stdout)) == [
            "%\(space.tab.paneID.uuidString.lowercased())",
            "%\(splitPaneID.uuidString.lowercased())",
          ])

        let displayed = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "display-message", "-p", "-t",
              "%\(splitPaneID.uuidString.lowercased())", "#{pane_id}:#{pane_index}",
            ],
            cwd: space.directory
          )
        )
        #expect(
          displayed.stdout.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix(
            "%\(splitPaneID.uuidString.lowercased()):"))

        let marker = "tmux-\(space.token)"
        _ = try requireSuccessfulSPResult(
          try runner.run(
            [
              "tmux", "--socket", app.socketPath, "--", "send-keys", "-t",
              "%\(splitPaneID.uuidString.lowercased())", "echo \(marker) > tmux.txt", "Enter",
            ],
            cwd: space.directory
          )
        )
        let file = space.directory.appendingPathComponent("tmux.txt", isDirectory: false)
        try await app.waitUntil("tmux send-keys writes tmux.txt") {
          (try? String(contentsOf: file, encoding: .utf8))?.contains(marker) == true
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func paneWaitReadyReturnsExpectedExitCodes() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let ready = try requireSuccessfulSPResult(
          try runner.run(
            [
              "pane", "wait-ready", "--socket", app.socketPath, space.tab.paneID.uuidString,
              "--timeout", "5", "--plain",
            ],
            cwd: space.directory
          )
        )
        #expect(ready.stdout.contains("ready"))

        let missing = try runner.run(
          [
            "pane", "wait-ready", "--socket", app.socketPath,
            "00000000-0000-0000-0000-000000000000", "--timeout", "0.1", "--plain",
          ],
          cwd: space.directory
        )
        #expect(missing.exitCode != 0)
        #expect(missing.stderr.contains("No pane exists with UUID"))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func jsonTreeMatchesSocketSnapshot() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let result = try requireSuccessfulSPResult(
          try runner.run(["ls", "--socket", app.socketPath, "--json"], cwd: space.directory)
        )
        let data = try #require(result.stdout.data(using: .utf8))
        let decoded = try JSONDecoder().decode(SupatermTreeSnapshot.self, from: data)
        let socket = try app.send(.tree(), as: SupatermTreeSnapshot.self)
        #expect(stableTreeRows(decoded) == stableTreeRows(socket))
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func developmentHookRoundTripsThroughEmbeddedBinary() async throws {
      try await withTestSpace { app, space in
        try await app.waitForShellPrompt(space.pane)
        let runner = spRunner(app, tabID: space.tab.tabID, paneID: space.tab.paneID)
        let sessionID = "e2e-\(space.token)"
        let start = try requireSuccessfulSPResult(
          try runner.run(
            [
              "internal", "dev", "claude", "session-start", "--socket", app.socketPath,
              "--session-id", sessionID,
            ],
            cwd: space.directory
          )
        )
        #expect(start.stdout.contains("sent session-start for session \(sessionID)"))

        let end = try requireSuccessfulSPResult(
          try runner.run(
            [
              "internal", "dev", "claude", "session-end", "--socket", app.socketPath,
              "--session-id", sessionID,
            ],
            cwd: space.directory
          )
        )
        #expect(end.stdout.contains("sent session-end for session \(sessionID)"))
      }
    }
  }
}

private func spRunner(_ app: SupatermE2EApp, tabID: UUID, paneID: UUID) -> SPBinaryRunner {
  SPBinaryRunner(
    executable: app.spExecutable,
    environment: app.cliEnvironment(context: app.context(tabID: tabID, paneID: paneID))
  )
}

private func parseEnvironment(_ output: String) -> [String: String] {
  output.split(whereSeparator: \.isNewline).reduce(into: [:]) { result, line in
    let entry = String(line)
    guard let separator = entry.firstIndex(of: "=") else { return }
    result[String(entry[..<separator])] = String(entry[entry.index(after: separator)...])
  }
}

private func outputLines(_ output: String) -> [String] {
  output.split(whereSeparator: \.isNewline).map(String.init)
}

private func stableTreeRows(_ tree: SupatermTreeSnapshot) -> [String] {
  tree.windows.flatMap { window in
    window.spaces.flatMap { space in
      space.tabs.flatMap { tab in
        tab.panes.map { pane in
          [
            "window:\(window.index):\(window.isKey)",
            "space:\(space.index):\(space.id):\(space.isSelected)",
            "tab:\(tab.index):\(tab.id):\(tab.isSelected)",
            "pane:\(pane.index):\(pane.id):\(pane.isFocused)",
          ].joined(separator: "|")
        }
      }
    }
  }
}

private func tmuxPaneID(_ output: String) throws -> UUID {
  let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
  guard trimmed.first == "%" else {
    throw SupatermE2EError("Expected tmux pane id, got \(trimmed).")
  }
  guard let id = UUID(uuidString: String(trimmed.dropFirst())) else {
    throw SupatermE2EError("Invalid tmux pane id: \(trimmed).")
  }
  return id
}
