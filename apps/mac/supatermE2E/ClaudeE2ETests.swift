import Foundation
import SupatermCLIShared
import Testing

private let claudeE2EBinaryURL = ProcessInfo.processInfo.environment["CLAUDE_E2E_BINARY"]
  .flatMap { path in path.isEmpty ? nil : URL(fileURLWithPath: path) }
private let claudeE2EEnabled =
  claudeE2EBinaryURL
  .map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false

@Suite(.enabled(if: claudeE2EEnabled, "Run through make mac-test-e2e."))
struct ClaudeE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackEveryRootStateAndInterrupt() async throws {
    try await runClaudeLifecycle(mode: .screenRules)
  }

  @Test(.timeLimit(.minutes(5)))
  func hooksAugmentScreenRulesAcrossEveryRootStateAndInterrupt() async throws {
    try await runClaudeLifecycle(mode: .hooks)
  }
}

private enum ClaudeE2EMode {
  case hooks
  case screenRules

  var hooksEnabled: Bool {
    self == .hooks
  }
}

private struct ClaudeE2EEnvironment {
  let executable: URL

  init() throws {
    guard let executable = claudeE2EBinaryURL else {
      throw SupatermE2EError("Missing CLAUDE_E2E_BINARY.")
    }
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError("Claude is not executable at \(executable.path).")
    }
    self.executable = executable
  }
}

private final class ClaudeE2EFixture {
  let app: SupatermE2EApp
  let mode: ClaudeE2EMode
  let server: FakeModelServer
  let space: TestSpace
  let initialProcess: SupatermAgentExplainResult.Process
  var sessionID: String?

  private init(
    app: SupatermE2EApp,
    mode: ClaudeE2EMode,
    server: FakeModelServer,
    space: TestSpace,
    initialProcess: SupatermAgentExplainResult.Process,
    sessionID: String?
  ) {
    self.app = app
    self.mode = mode
    self.server = server
    self.space = space
    self.initialProcess = initialProcess
    self.sessionID = sessionID
  }

  static func launch(mode: ClaudeE2EMode) async throws -> ClaudeE2EFixture {
    let environment = try ClaudeE2EEnvironment()
    let app = try await SupatermE2EApp.launch(
      pathDirectories: [environment.executable.deletingLastPathComponent()]
    )
    var server: FakeModelServer?
    do {
      let space = try await makeTestSpace(app)
      let startedServer = try FakeModelServer(script: makeClaudeScript(space))
      server = startedServer
      try writeClaudeState(home: app.cliHome, workspace: space.directory)
      let launchExecutable = try makeClaudeLaunchExecutable(
        environment.executable,
        home: app.cliHome
      )
      if mode.hooksEnabled {
        let runner = SPBinaryRunner(
          app: app,
          tabID: space.tab.tabID,
          paneID: space.tab.paneID
        )
        try await installAgentHook(
          .claude,
          runner: runner,
          socketPath: app.socketPath,
          workspace: space.directory,
          app: app
        )
      }
      let command = SupatermShellCommand.escapedCommand([
        "/usr/bin/env",
        "-u",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN=test",
        "ANTHROPIC_BASE_URL=\(startedServer.baseURL)",
        "ANTHROPIC_MODEL=claude-haiku-4-5-20251001",
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
        "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
        "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1",
        "CLAUDE_CONFIG_DIR=\(app.cliHome.appendingPathComponent(".claude").path)",
        "DISABLE_AUTOUPDATER=1",
        "DISABLE_TELEMETRY=1",
        "DISABLE_UPDATES=1",
        launchExecutable.path,
        "--effort",
        "low",
        "--permission-mode",
        "manual",
        "--no-chrome",
        "--strict-mcp-config",
        "--mcp-config",
        #"{"mcpServers":{}}"#,
        "--tools",
        "AskUserQuestion,Bash",
      ])
      try app.type(command + "\n", into: space.pane)
      let initial = try await waitForClaudeExplain(
        app,
        target: space.pane,
        phase: .idle
      )
      let initialProcess = try requireValue(
        initial.process,
        "Claude detection has no process identity."
      )
      try await app.waitForCapture(space.pane, contains: "manual mode on", timeout: 60)
      let fixture = ClaudeE2EFixture(
        app: app,
        mode: mode,
        server: startedServer,
        space: space,
        initialProcess: initialProcess,
        sessionID: nil
      )
      try await fixture.expect(.idle)
      return fixture
    } catch {
      server?.stop()
      app.terminate()
      throw error
    }
  }

  func close() {
    try? closeTestSpace(app, spaceID: space.spaceID)
    app.terminate()
    server.stop()
  }

  func expect(
    _ phase: SupatermAgentExplainResult.Phase,
    timeout: TimeInterval = 90
  ) async throws {
    try checkServer()
    let result = try await waitForClaudeExplain(app, target: space.pane, phase: phase, timeout: timeout)
    try checkServer()
    #expect(result.process == initialProcess)
    if mode.hooksEnabled {
      var nextSessionID: String?
      try await app.waitUntil("the native Claude session remains bound", timeout: timeout) {
        guard let agent = try app.debugPane(space.tab.paneID)?.agent else { return false }
        let matchesSession = sessionID.map { agent.sessionID == $0 } ?? true
        guard agent.kind == .claude, matchesSession else { return false }
        nextSessionID = agent.sessionID
        return true
      }
      sessionID = sessionID ?? nextSessionID
    } else {
      try await app.waitUntil("the pane has no native Claude session", timeout: timeout) {
        guard let pane = try app.debugPane(space.tab.paneID) else { return false }
        return pane.agent == nil
      }
    }
  }

  private func checkServer() throws {
    if let failure = server.recordedFailure {
      throw SupatermE2EError(failure)
    }
  }

  func approve() throws {
    try app.press(.enter, in: space.pane)
  }

  private static func writeClaudeState(home: URL, workspace: URL) throws {
    let configDirectory = home.appendingPathComponent(".claude", isDirectory: true)
    try FileManager.default.createDirectory(
      at: configDirectory,
      withIntermediateDirectories: true
    )
    let state: [String: Any] = [
      "hasCompletedOnboarding": true,
      "projects": [
        claudeProjectPath(workspace): ["hasTrustDialogAccepted": true]
      ],
    ]
    let data = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
    try data.write(
      to: configDirectory.appendingPathComponent(".claude.json", isDirectory: false)
    )
  }
}

private func claudeProjectPath(_ workspace: URL) -> String {
  let path = workspace.standardizedFileURL.path
  return path.hasPrefix("/var/") ? "/private\(path)" : path
}

private func makeClaudeLaunchExecutable(_ executable: URL, home: URL) throws -> URL {
  let source = executable.resolvingSymlinksInPath()
  guard source.lastPathComponent != "claude" else { return source }
  let directory = home.appendingPathComponent("bin", isDirectory: true)
  let destination = directory.appendingPathComponent("claude", isDirectory: false)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  do {
    try FileManager.default.linkItem(at: source, to: destination)
  } catch {
    try FileManager.default.copyItem(at: source, to: destination)
  }
  return destination
}

private func runClaudeLifecycle(mode: ClaudeE2EMode) async throws {
  let fixture = try await ClaudeE2EFixture.launch(mode: mode)
  defer { fixture.close() }

  try await runCompletedClaudeTurn(fixture)
  try await runInterruptedClaudeTurn(fixture, key: .escape, name: "escape")
  try await runInterruptedClaudeTurn(fixture, key: .ctrlC, name: "ctrl-c")
  try fixture.server.verifyComplete()
}

private func runCompletedClaudeTurn(_ fixture: ClaudeE2EFixture) async throws {
  let question = claudeLifecycleQuestion(fixture.space)
  let completion = claudeLifecycleCompletion(fixture.space)
  let marker = claudeLifecycleMarker(fixture.space)
  let command = claudeLifecycleCommand(fixture.space)
  let submissionMarker = "Lifecycle prompt \(fixture.space.token)."
  let prompt = [
    submissionMarker,
    "First call AskUserQuestion with one question.",
    "Use header \"E2E\", question \"\(question)\", and two options named \"Proceed\" and \"Stop\".",
    "After the answer, use Bash once to run exactly `\(command)`.",
    "After it finishes, reply with exactly `\(completion)`.",
    "Do not call any other tool.",
  ].joined(separator: " ")

  try await fixture.app.submit(prompt, waitingFor: submissionMarker, into: fixture.space.pane)
  try await fixture.expect(.running)
  fixture.server.releaseNextResponse()
  try await fixture.app.waitForCapture(fixture.space.pane, contains: question, timeout: 90)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await fixture.expect(.running)
  let completionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: completion).count
  fixture.server.releaseNextResponse()
  try await waitForClaudeCommandApproval(fixture, marker: marker)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await fixture.expect(.running)
  fixture.server.releaseNextResponse()
  try await fixture.app.waitUntil("Claude prints the lifecycle completion", timeout: 90) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: completion).count > completionCount
  }
  try await fixture.expect(.idle)

}

private func runInterruptedClaudeTurn(
  _ fixture: ClaudeE2EFixture,
  key: SupatermInputKey,
  name: String
) async throws {
  let startedURL = claudeInterruptedStartedURL(fixture.space, name: name)
  let command = claudeInterruptedCommand(fixture.space, name: name)
  let submissionMarker = "Interrupt prompt \(name) \(fixture.space.token)."
  let prompt =
    "\(submissionMarker) Use Bash once to run exactly `\(command)`. Do not do anything else until it finishes."

  try await fixture.app.submit(
    prompt,
    waitingFor: submissionMarker,
    into: fixture.space.pane
  )
  try await fixture.expect(.running)
  fixture.server.releaseNextResponse()
  try await waitForClaudeCommandApproval(fixture, marker: startedURL.lastPathComponent)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await fixture.expect(.running)
  try await fixture.app.waitUntil("Claude starts the \(name) command", timeout: 10) {
    FileManager.default.fileExists(atPath: startedURL.path)
  }
  try fixture.app.press(key, in: fixture.space.pane)
  try await fixture.expect(.idle, timeout: 10)
}

private func waitForClaudeExplain(
  _ app: SupatermE2EApp,
  target: SupatermPaneTargetRequest,
  phase: SupatermAgentExplainResult.Phase,
  timeout: TimeInterval = 90
) async throws -> SupatermAgentExplainResult {
  var lastResult: SupatermAgentExplainResult?
  do {
    try await app.waitUntil("Claude screen rules resolve \(phase.rawValue)", timeout: timeout) {
      let result = try app.agentExplain(target)
      lastResult = result
      return result.mode == .fallback
        && result.status == .resolved
        && result.agent?.id == "claude"
        && result.agent?.phase == phase
    }
  } catch {
    throw SupatermE2EError(
      "\(error)\n--- last agent explain ---\n\(String(describing: lastResult))"
        + "\n--- pane capture ---\n\((try? app.capture(target)) ?? "unavailable")"
    )
  }
  return try requireValue(lastResult, "Claude screen rules produced no result.")
}

private func waitForClaudeCommandApproval(
  _ fixture: ClaudeE2EFixture,
  marker: String
) async throws {
  var lastCapture = ""
  do {
    try await fixture.app.waitUntil("the current Claude command approval is ready", timeout: 20) {
      lastCapture = try fixture.app.capture(fixture.space.pane)
      return lastCapture.contains(marker)
        && lastCapture.localizedCaseInsensitiveContains("Do you want to proceed?")
    }
  } catch {
    throw SupatermE2EError("\(error)\n--- pane capture ---\n\(lastCapture)")
  }
}

private enum ClaudeFakeCallID {
  static let lifecycleCommand = "claude-lifecycle-command"
  static let lifecycleQuestion = "claude-lifecycle-question"
  static let escapeCommand = "claude-escape-command"
  static let ctrlCCommand = "claude-ctrl-c-command"
}

private func makeClaudeScript(_ space: TestSpace) -> [FakeModelExchange] {
  [
    FakeModelExchange(
      request: .messagesInputText(claudeLifecycleQuestion(space)),
      response: .messagesAskUserQuestion(
        callID: ClaudeFakeCallID.lifecycleQuestion,
        question: claudeLifecycleQuestion(space)
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesToolResult(callID: ClaudeFakeCallID.lifecycleQuestion),
      response: .messagesBash(
        callID: ClaudeFakeCallID.lifecycleCommand,
        command: claudeLifecycleCommand(space)
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesToolResult(callID: ClaudeFakeCallID.lifecycleCommand),
      response: .messagesText(claudeLifecycleCompletion(space)),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesInputText(claudeInterruptedStartedURL(space, name: "escape").lastPathComponent),
      response: .messagesBash(
        callID: ClaudeFakeCallID.escapeCommand,
        command: claudeInterruptedCommand(space, name: "escape")
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesInputText(claudeInterruptedStartedURL(space, name: "ctrl-c").lastPathComponent),
      response: .messagesBash(
        callID: ClaudeFakeCallID.ctrlCCommand,
        command: claudeInterruptedCommand(space, name: "ctrl-c")
      ),
      waitForRelease: true
    ),
  ]
}

private func claudeLifecycleQuestion(_ space: TestSpace) -> String {
  "Proceed with Claude lifecycle check \(space.token)?"
}

private func claudeLifecycleCompletion(_ space: TestSpace) -> String {
  "CLAUDE_LIFECYCLE_DONE_\(space.token)"
}

private func claudeLifecycleMarker(_ space: TestSpace) -> String {
  "claude-lifecycle-\(space.token)"
}

private func claudeLifecycleCommand(_ space: TestSpace) -> String {
  SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/bin/sleep 0.1; /usr/bin/true \(claudeLifecycleMarker(space))",
  ])
}

private func claudeInterruptedStartedURL(_ space: TestSpace, name: String) -> URL {
  space.directory.appendingPathComponent("claude-\(name)-running-\(space.token)")
}

private func claudeInterruptedCommand(_ space: TestSpace, name: String) -> String {
  SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/usr/bin/touch \(claudeInterruptedStartedURL(space, name: name).path); /bin/sleep 30",
  ])
}
