import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SPAgentHookE2ETests {
    @Test(.timeLimit(.minutes(5)))
    func codexNestedSessionCannotReplaceEitherPaneRootSession() async throws {
      try await withTestSpace { app, space in
        let split = try makeSplit(app, in: space)
        let secondPane = SupatermPaneTargetRequest(paneID: split.paneID)
        try await app.waitForShellPrompt(secondPane)

        let firstSessionID = "first-\(space.token)"
        let secondSessionID = "second-\(space.token)"
        let firstRunner = SPBinaryRunner(
          app: app,
          tabID: space.tab.tabID,
          paneID: space.tab.paneID
        )
        let secondRunner = SPBinaryRunner(
          app: app,
          tabID: split.tabID,
          paneID: split.paneID
        )
        try sendCodexSessionStart(
          sessionID: firstSessionID,
          app: app,
          space: space,
          runner: firstRunner
        )
        try sendCodexSessionStart(
          sessionID: secondSessionID,
          app: app,
          space: space,
          runner: secondRunner
        )
        try await app.waitUntil("both panes bind their Codex root sessions") {
          try app.debugPane(space.tab.paneID)?.agent?.sessionID == firstSessionID
            && app.debugPane(split.paneID)?.agent?.sessionID == secondSessionID
        }

        var firstNestedEnvironment = firstRunner.environment
        firstNestedEnvironment[SupatermCodexEnvironment.threadIDKey] = firstSessionID
        let firstNestedRunner = SPBinaryRunner(
          executable: firstRunner.executable,
          environment: firstNestedEnvironment
        )
        try sendCodexSessionStart(
          sessionID: "first-nested-\(space.token)",
          app: app,
          space: space,
          runner: firstNestedRunner
        )
        try sendCodexSessionStart(
          sessionID: "first-ephemeral-\(space.token)",
          app: app,
          space: space,
          runner: firstRunner,
          isPersisted: false
        )
        var secondNestedEnvironment = secondRunner.environment
        secondNestedEnvironment[SupatermCodexEnvironment.threadIDKey] = secondSessionID
        let secondNestedRunner = SPBinaryRunner(
          executable: secondRunner.executable,
          environment: secondNestedEnvironment
        )
        try sendCodexSessionStart(
          sessionID: "second-nested-\(space.token)",
          app: app,
          space: space,
          runner: secondNestedRunner
        )
        try sendCodexSessionStart(
          sessionID: "second-ephemeral-\(space.token)",
          app: app,
          space: space,
          runner: secondRunner,
          isPersisted: false
        )

        #expect(try app.debugPane(space.tab.paneID)?.agent?.sessionID == firstSessionID)
        #expect(try app.debugPane(split.paneID)?.agent?.sessionID == secondSessionID)
      }
    }
  }
}

private func sendCodexSessionStart(
  sessionID: String,
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner,
  isPersisted: Bool = true
) throws {
  let event = SupatermAgentHookEvent(
    cwd: space.directory.path,
    hookEventName: .sessionStart,
    sessionID: sessionID,
    transcriptPath: isPersisted
      ? space.directory.appendingPathComponent("\(sessionID).jsonl").path
      : nil
  )
  _ = try requireSuccessfulSPResult(
    try runner.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--socket", app.socketPath],
      cwd: space.directory,
      stdin: try JSONEncoder().encode(event)
    )
  )
}
