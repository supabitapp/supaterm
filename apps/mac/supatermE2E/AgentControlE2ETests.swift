import Foundation
import SupatermCLIShared
import Testing

@Suite(.enabled(if: codexE2EEnabled, "Run through make mac-test-e2e."))
struct AgentControlE2ETests {
  @Test(.timeLimit(.minutes(5)), arguments: [false, true])
  func guardedSubmissionAndWaitUseLiveProcessIdentity(_ zmx: Bool) async throws {
    let prompt = "Check guarded input.\nPreserve this second line."
    let marker = "guarded-response-\(UUID().uuidString)"
    let fixture = try await CodexE2EFixture.launch(mode: zmx ? .zmxScreenRules : .screenRules) { _ in
      [FakeModelExchange(request: .responsesInputText(prompt), response: .responsesMessage(marker))]
    }
    defer { fixture.close() }
    let runner = SPBinaryRunner(app: fixture.app, tabID: fixture.space.tab.tabID, paneID: fixture.space.tab.paneID)
    let pane = fixture.space.tab.paneID.uuidString
    let waited = try requireSuccessfulSPResult(
      runner.run([
        "agent", "wait", pane, "--until", "idle", "--expect-agent", "codex", "--json"
      ]))
    let result = try decodeSPJSON(SupatermAgentWaitResult.self, from: waited)
    #expect(result.identity?.process == fixture.initialProcess)
    let process = fixture.initialProcess
    let rejected = try requireFailedSPResult(
      runner.run([
        "pane", "send", "--submit", "--expect-agent", "codex",
        "--expect-process", "\(process.processID):\(process.startTimeMicroseconds + 1)", pane, "wrong process"
      ]))
    #expect(rejected.stderr.contains("no longer matches"))
    try requireSuccessfulSPResult(
      runner.run(
        [
          "pane", "send", "--submit", "--expect-agent", "codex",
          "--expect-process", "\(process.processID):\(process.startTimeMicroseconds)", pane, "-"
        ], stdin: Data(prompt.utf8)))
    try await fixture.app.waitForCapture(fixture.space.pane, contains: marker)
    try fixture.server.verifyComplete()
  }

  @Test(.timeLimit(.minutes(5)), arguments: [false, true])
  func waitTracksRunningTimeoutAndReturnToIdle(_ zmx: Bool) async throws {
    let prompt = "Hold this reply until released."
    let marker = "wait-completed-\(UUID().uuidString)"
    let fixture = try await CodexE2EFixture.launch(mode: zmx ? .zmxScreenRules : .screenRules) { _ in
      [
        FakeModelExchange(
          request: .responsesInputText(prompt), response: .responsesMessage(marker), waitForRelease: true
        )
      ]
    }
    defer { fixture.close() }
    let runner = SPBinaryRunner(app: fixture.app, tabID: fixture.space.tab.tabID, paneID: fixture.space.tab.paneID)
    try requireSuccessfulSPResult(
      runner.run(
        ["pane", "send", "--submit"] + agentGuardArguments(fixture) + [fixture.space.tab.paneID.uuidString, prompt]
      ))
    try await fixture.expect(.running)

    let running = try requireSuccessfulSPResult(runner.run(waitArguments(fixture, until: "running")))
    #expect(try decodeSPJSON(SupatermAgentWaitResult.self, from: running).outcome == .running)
    let timedOut = try requireFailedSPResult(runner.run(waitArguments(fixture, until: "idle", timeout: "0.3")))
    let timedOutResult = try decodeSPJSON(SupatermAgentWaitResult.self, from: timedOut)
    #expect(timedOutResult.outcome == .timeout)
    #expect(!timedOutResult.matched)
    #expect(timedOutResult.identity?.process == fixture.initialProcess)

    fixture.server.releaseNextResponse()
    let idle = try requireSuccessfulSPResult(runner.run(waitArguments(fixture, until: "idle"), timeout: 15))
    let idleResult = try decodeSPJSON(SupatermAgentWaitResult.self, from: idle)
    #expect(idleResult.outcome == .idle)
    #expect(idleResult.matched)
    #expect(idleResult.identity?.process == fixture.initialProcess)
    try await fixture.app.waitForCapture(fixture.space.pane, contains: marker)
    try fixture.server.verifyComplete()
  }

  @Test(.timeLimit(.minutes(5)), arguments: [false, true])
  func blockedAgentRejectsSubmissionWithoutApprovingCommand(_ zmx: Bool) async throws {
    let prompt = "Request permission for the test command."
    let fixture = try await CodexE2EFixture.launch(mode: zmx ? .zmxScreenRules : .screenRules) { space in
      [
        FakeModelExchange(
          request: .responsesInputText(prompt),
          response: .responsesExecCommand(
            callID: "guarded-approval",
            command: "touch \(space.directory.appendingPathComponent("unapproved.txt").path)"
          )
        )
      ]
    }
    defer { fixture.close() }
    let runner = SPBinaryRunner(app: fixture.app, tabID: fixture.space.tab.tabID, paneID: fixture.space.tab.paneID)
    try requireSuccessfulSPResult(
      runner.run(
        ["pane", "send", "--submit"] + agentGuardArguments(fixture) + [fixture.space.tab.paneID.uuidString, prompt]
      ))
    try await fixture.expect(.needsInput)
    let blocked = try requireSuccessfulSPResult(runner.run(waitArguments(fixture, until: "needs_input")))
    let blockedResult = try decodeSPJSON(SupatermAgentWaitResult.self, from: blocked)
    #expect(blockedResult.outcome == .needsInput)
    #expect(blockedResult.matched)
    #expect(blockedResult.identity?.process == fixture.initialProcess)

    let rejected = try requireFailedSPResult(
      runner.run(
        ["pane", "send", "--submit"] + agentGuardArguments(fixture) + [fixture.space.tab.paneID.uuidString, "y"]
      ))
    #expect(rejected.stderr.contains("needs input"))
    let stillBlocked = try requireFailedSPResult(runner.run(waitArguments(fixture, until: "idle", timeout: "0.3")))
    #expect(try decodeSPJSON(SupatermAgentWaitResult.self, from: stillBlocked).outcome == .timeout)
    try await fixture.expect(.needsInput)
    #expect(
      !FileManager.default.fileExists(atPath: fixture.space.directory.appendingPathComponent("unapproved.txt").path))
    try fixture.server.verifyComplete()
  }

  @Test(.timeLimit(.minutes(5)), arguments: [false, true])
  func exitedAndRestartedAgentRejectsStaleProcessIdentity(_ zmx: Bool) async throws {
    let freshPrompt = "Prompt for the replacement agent."
    let freshMarker = "replacement-response-\(UUID().uuidString)"
    let fixture = try await CodexE2EFixture.launch(mode: zmx ? .zmxScreenRules : .screenRules) { _ in
      [FakeModelExchange(request: .responsesInputText(freshPrompt), response: .responsesMessage(freshMarker))]
    }
    defer { fixture.close() }
    let runner = SPBinaryRunner(app: fixture.app, tabID: fixture.space.tab.tabID, paneID: fixture.space.tab.paneID)
    let pane = fixture.space.tab.paneID.uuidString
    try await stopCodex(fixture)

    let exited = try requireSuccessfulSPResult(runner.run(waitArguments(fixture, until: "exited")))
    let exitedResult = try decodeSPJSON(SupatermAgentWaitResult.self, from: exited)
    #expect(exitedResult.outcome == .exited)
    #expect(exitedResult.matched)
    #expect(exitedResult.identity?.process == fixture.initialProcess)
    let unexpectedExit = try requireFailedSPResult(runner.run(waitArguments(fixture, until: "idle")))
    #expect(try decodeSPJSON(SupatermAgentWaitResult.self, from: unexpectedExit).outcome == .exited)
    let rejectedByShell = try requireFailedSPResult(
      runner.run(
        ["pane", "send", "--submit"] + agentGuardArguments(fixture) + [pane, "touch stale-agent-input.txt"]
      ))
    #expect(rejectedByShell.stderr.contains("no longer running"))

    let restartedProcess = try await fixture.restart()
    #expect(restartedProcess != fixture.initialProcess)
    let replaced = try requireFailedSPResult(runner.run(waitArguments(fixture, until: "idle")))
    let replacedResult = try decodeSPJSON(SupatermAgentWaitResult.self, from: replaced)
    #expect(replacedResult.outcome == .replaced)
    #expect(!replacedResult.matched)
    #expect(replacedResult.identity?.process == fixture.initialProcess)
    let rejectedByReplacement = try requireFailedSPResult(
      runner.run(
        ["pane", "send", "--submit"] + agentGuardArguments(fixture) + [pane, "stale replacement prompt"]
      ))
    #expect(rejectedByReplacement.stderr.contains("no longer matches"))
    let staleInputFile = fixture.space.directory.appendingPathComponent("stale-agent-input.txt")
    #expect(!FileManager.default.fileExists(atPath: staleInputFile.path))
    try requireSuccessfulSPResult(
      runner.run([
        "pane", "send", "--submit", "--expect-agent", "codex",
        "--expect-process", "\(restartedProcess.processID):\(restartedProcess.startTimeMicroseconds)", pane, freshPrompt
      ]))
    try await fixture.app.waitForCapture(fixture.space.pane, contains: freshMarker)
    try fixture.server.verifyComplete()
  }
}

private func agentGuardArguments(_ fixture: CodexE2EFixture) -> [String] {
  let process = fixture.initialProcess
  return ["--expect-agent", "codex", "--expect-process", "\(process.processID):\(process.startTimeMicroseconds)"]
}

private func waitArguments(_ fixture: CodexE2EFixture, until: String, timeout: String = "10") -> [String] {
  ["agent", "wait", fixture.space.tab.paneID.uuidString, "--until", until, "--timeout", timeout, "--json"]
    + agentGuardArguments(fixture)
}
