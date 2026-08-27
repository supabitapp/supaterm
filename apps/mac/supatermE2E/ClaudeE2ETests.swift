import Foundation
import SupatermCLIShared
import Testing

private let claudeE2EBinaryURL = ProcessInfo.processInfo.environment["CLAUDE_E2E_BINARY"]
  .flatMap { path in path.isEmpty ? nil : URL(fileURLWithPath: path) }
let claudeE2EEnabled =
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

  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackSplitPanesIndependently() async throws {
    try await runClaudeSplitPanes()
  }
}

@Suite(.enabled(if: claudeE2EEnabled, "Run through make mac-test-e2e."))
struct ClaudeZmxE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackEveryRootStateAndInterrupt() async throws {
    try await runClaudeLifecycle(mode: .zmxScreenRules)
  }

  @Test(.timeLimit(.minutes(5)))
  func detectionSurvivesAppRelaunchMidTurn() async throws {
    try await runClaudeRelaunchLifecycle()
  }
}

private enum ClaudeE2EMode {
  case hooks
  case screenRules
  case zmxScreenRules

  var hooksEnabled: Bool {
    self == .hooks
  }

  var zmxSessionsEnabled: Bool {
    self == .zmxScreenRules
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
  let initialProcess: SupatermAppDebugSnapshot.AgentProcess
  var sessionID: String?

  private init(
    app: SupatermE2EApp,
    mode: ClaudeE2EMode,
    server: FakeModelServer,
    space: TestSpace,
    initialProcess: SupatermAppDebugSnapshot.AgentProcess,
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
      zmxSessionsEnabled: mode.zmxSessionsEnabled,
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
        try await installAgentHooks(
          runner: runner,
          socketPath: app.socketPath,
          workspace: space.directory,
          app: app
        )
      }
      let command = makeClaudeCommand(
        baseURL: startedServer.baseURL,
        home: app.cliHome,
        executable: launchExecutable
      )
      try app.type(command + "\n", into: space.pane)
      let initial = try await waitForAgentSnapshot(
        app,
        paneID: space.tab.paneID,
        kind: .claude,
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
      try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox)
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
    _ phase: SupatermAppDebugSnapshot.AgentPhase,
    ruleIDs: Set<String>? = nil,
    timeout: TimeInterval = 90
  ) async throws {
    try checkServer()
    let agent = try await waitForAgentSnapshot(
      app,
      paneID: space.tab.paneID,
      kind: .claude,
      phase: phase,
      ruleIDs: ruleIDs,
      timeout: timeout
    )
    try checkServer()
    #expect(agent.process == initialProcess)
    if mode.hooksEnabled {
      var nextSessionID: String?
      try await app.waitUntil("the native Claude session remains bound", timeout: timeout) {
        guard
          let agent = try app.debugPane(space.tab.paneID)?.agent,
          let boundSessionID = agent.sessionID
        else {
          return false
        }
        let matchesSession = sessionID.map { boundSessionID == $0 } ?? true
        guard agent.kind == .claude, matchesSession else { return false }
        nextSessionID = boundSessionID
        return true
      }
      sessionID = sessionID ?? nextSessionID
    } else {
      try await app.waitUntil("the pane has no native Claude session", timeout: timeout) {
        guard let pane = try app.debugPane(space.tab.paneID) else { return false }
        return pane.agent?.sessionID == nil
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

}

private func writeClaudeState(home: URL, workspace: URL) throws {
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

private func claudeProjectPath(_ workspace: URL) -> String {
  let path = workspace.standardizedFileURL.path
  return path.hasPrefix("/var/") ? "/private\(path)" : path
}

private func makeClaudeCommand(baseURL: String, home: URL, executable: URL) -> String {
  SupatermShellCommand.escapedCommand([
    "/usr/bin/env",
    "-u",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN=test",
    "ANTHROPIC_BASE_URL=\(baseURL)",
    "ANTHROPIC_MODEL=claude-haiku-4-5-20251001",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
    "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1",
    "CLAUDE_CONFIG_DIR=\(home.appendingPathComponent(".claude").path)",
    "DISABLE_AUTOUPDATER=1",
    "DISABLE_TELEMETRY=1",
    "DISABLE_UPDATES=1",
    executable.path,
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

func makeClaudeNarrowTabFixture(
  app: SupatermE2EApp,
  space: TestSpace,
  tab: SupatermNewTabResult
) async throws -> NarrowAgentTabFixture {
  let environment = try ClaudeE2EEnvironment()
  let marker = "ncl-\(space.token)"
  let server = try FakeModelServer(script: [
    FakeModelExchange(
      request: .messagesInputText(marker),
      response: .messagesText("CLAUDE_NARROW_DONE_\(space.token)"),
      waitForRelease: true
    )
  ])
  do {
    try writeClaudeState(home: app.cliHome, workspace: space.directory)
    let launchExecutable = try makeClaudeLaunchExecutable(
      environment.executable,
      home: app.cliHome
    )
    let pane = SupatermPaneTargetRequest(paneID: tab.paneID)
    try app.type(
      makeClaudeCommand(
        baseURL: server.baseURL,
        home: app.cliHome,
        executable: launchExecutable
      ) + "\n",
      into: pane
    )
    _ = try await waitForAgentSnapshot(
      app,
      paneID: tab.paneID,
      kind: .claude,
      phase: .idle,
      ruleIDs: ClaudeRuleID.promptBox
    )
    try await app.waitForCapture(pane, contains: "manual mode on", timeout: 60)
    return NarrowAgentTabFixture(
      kind: .claude,
      pane: pane,
      prompt: "\(marker) Reply once with exactly CLAUDE_NARROW_DONE_\(space.token).",
      promptMarker: marker,
      runningRuleIDs: ClaudeRuleID.workingTitle,
      server: server
    )
  } catch {
    server.stop()
    throw error
  }
}

private func runClaudeSplitPanes() async throws {
  let environment = try ClaudeE2EEnvironment()
  let app = try await SupatermE2EApp.launch(
    pathDirectories: [environment.executable.deletingLastPathComponent()]
  )
  var servers: [FakeModelServer] = []
  var spaceID: UUID?
  defer {
    if let spaceID {
      try? closeTestSpace(app, spaceID: spaceID)
    }
    app.terminate()
    for server in servers {
      server.stop()
    }
  }

  let space = try await makeTestSpace(app)
  spaceID = space.spaceID
  let completion = "CLAUDE_SPLIT_DONE_\(space.token)"
  let submissionMarker = "Split prompt \(space.token)."
  let firstServer = try FakeModelServer(script: [
    FakeModelExchange(
      request: .messagesInputText(submissionMarker),
      response: .messagesText(completion),
      waitForRelease: true
    )
  ])
  servers.append(firstServer)
  let secondServer = try FakeModelServer(script: [])
  servers.append(secondServer)
  try writeClaudeState(home: app.cliHome, workspace: space.directory)
  let launchExecutable = try makeClaudeLaunchExecutable(environment.executable, home: app.cliHome)

  let split = try makeSplit(app, in: space)
  let firstPaneID = space.tab.paneID
  let secondPaneID = split.paneID
  let firstPane = SupatermPaneTargetRequest(paneID: firstPaneID)
  let secondPane = SupatermPaneTargetRequest(paneID: secondPaneID)
  try await app.waitForShellPrompt(secondPane)
  try app.type(
    makeClaudeCommand(baseURL: firstServer.baseURL, home: app.cliHome, executable: launchExecutable)
      + "\n",
    into: firstPane
  )
  try app.type(
    makeClaudeCommand(baseURL: secondServer.baseURL, home: app.cliHome, executable: launchExecutable)
      + "\n",
    into: secondPane
  )
  let firstAgent = try await waitForAgentSnapshot(
    app,
    paneID: firstPaneID,
    kind: .claude,
    phase: .idle,
    ruleIDs: ClaudeRuleID.promptBox
  )
  let secondAgent = try await waitForAgentSnapshot(
    app,
    paneID: secondPaneID,
    kind: .claude,
    phase: .idle,
    ruleIDs: ClaudeRuleID.promptBox
  )
  let firstProcess = try requireValue(firstAgent.process, "The first pane has no process identity.")
  let secondProcess = try requireValue(
    secondAgent.process,
    "The second pane has no process identity."
  )
  #expect(firstProcess != secondProcess)

  try await app.submit(
    "\(submissionMarker) Reply with exactly \(completion).",
    waitingFor: submissionMarker,
    into: firstPane
  )
  _ = try await waitForAgentSnapshot(
    app,
    paneID: firstPaneID,
    kind: .claude,
    phase: .running,
    ruleIDs: ClaudeRuleID.workingTitle
  )
  try await assertAgentPhaseHolds(app, paneID: secondPaneID, kind: .claude, phase: .idle)
  firstServer.releaseNextResponse()
  let settledFirst = try await waitForAgentSnapshot(
    app,
    paneID: firstPaneID,
    kind: .claude,
    phase: .idle,
    ruleIDs: ClaudeRuleID.promptBox
  )
  let settledSecond = try await waitForAgentSnapshot(
    app,
    paneID: secondPaneID,
    kind: .claude,
    phase: .idle,
    ruleIDs: ClaudeRuleID.promptBox
  )
  #expect(settledFirst.process == firstProcess)
  #expect(settledSecond.process == secondProcess)
  try firstServer.verifyComplete()
  try secondServer.verifyComplete()
}

private func runClaudeLifecycle(mode: ClaudeE2EMode) async throws {
  let fixture = try await ClaudeE2EFixture.launch(mode: mode)
  defer { fixture.close() }

  try await runCompletedClaudeTurn(fixture)
  try await runClaudeModelPickerHold(fixture)
  try await runInterruptedClaudeTurn(fixture, key: .escape, name: "escape")
  try await runInterruptedClaudeTurn(fixture, key: .ctrlC, name: "ctrl-c")
  try await runCancelledClaudeTurn(fixture)
  try await runClaudeDraftClear(fixture)
  try await stopClaude(fixture)
  try fixture.server.verifyComplete()
}

private func runClaudeRelaunchLifecycle() async throws {
  let fixture = try await ClaudeE2EFixture.launch(mode: .zmxScreenRules)
  defer { fixture.close() }

  try await fixture.app.waitForPersistedStateQuiescence(
    containing: [fixture.space.tab.paneID.uuidString]
  )
  try await runCompletedClaudeTurn(fixture) {
    try await fixture.app.quit()
    try await fixture.app.relaunch()
    try await fixture.app.waitUntil("the Claude pane reattaches", timeout: 30) {
      try fixture.app.debugPane(fixture.space.tab.paneID) != nil
    }
    try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  }
  try await runInterruptedClaudeTurn(fixture, key: .escape, name: "escape")
  try await runInterruptedClaudeTurn(fixture, key: .ctrlC, name: "ctrl-c")
  try await runCancelledClaudeTurn(fixture)
  try await runClaudeDraftClear(fixture)
  try await stopClaude(fixture)
  try fixture.server.verifyComplete()
}

private func runCompletedClaudeTurn(
  _ fixture: ClaudeE2EFixture,
  afterRunning: (() async throws -> Void)? = nil
) async throws {
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
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  try await afterRunning?()
  fixture.server.releaseNextResponse()
  try await fixture.app.waitForCapture(fixture.space.pane, contains: question, timeout: 90)
  try await fixture.expect(.needsInput, ruleIDs: ClaudeRuleID.approvalForms)
  try fixture.approve()
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  let completionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: completion).count
  fixture.server.releaseNextResponse()
  try await waitForClaudeCommandApproval(fixture, marker: marker)
  try await fixture.expect(.needsInput, ruleIDs: ClaudeRuleID.approvalForms)
  try fixture.approve()
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  fixture.server.releaseNextResponse()
  try await fixture.app.waitUntil("Claude prints the lifecycle completion", timeout: 90) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: completion).count > completionCount
  }
  try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox)
}

private func runClaudeModelPickerHold(_ fixture: ClaudeE2EFixture) async throws {
  try fixture.app.type("/model", into: fixture.space.pane)
  try await fixture.app.waitForCapture(fixture.space.pane, contains: "/model", timeout: 10)
  try fixture.app.press(.enter, in: fixture.space.pane)
  try await fixture.app.waitUntil("the Claude model picker opens", timeout: 15) {
    try fixture.app.capture(fixture.space.pane)
      .localizedCaseInsensitiveContains("select model")
  }
  try await assertAgentPhaseHolds(
    fixture.app,
    paneID: fixture.space.tab.paneID,
    kind: .claude,
    phase: .idle
  )
  try fixture.app.press(.escape, in: fixture.space.pane)
  try await fixture.app.waitUntil("the Claude model picker closes", timeout: 10) {
    try !fixture.app.capture(fixture.space.pane)
      .localizedCaseInsensitiveContains("select model")
  }
  try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox, timeout: 10)
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
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  fixture.server.releaseNextResponse()
  try await waitForClaudeCommandApproval(fixture, marker: startedURL.lastPathComponent)
  try await fixture.expect(.needsInput, ruleIDs: ClaudeRuleID.approvalForms)
  try fixture.approve()
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  try await fixture.app.waitUntil("Claude starts the \(name) command", timeout: 10) {
    FileManager.default.fileExists(atPath: startedURL.path)
  }
  try fixture.app.press(key, in: fixture.space.pane)
  try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox, timeout: 10)
}

private func runCancelledClaudeTurn(_ fixture: ClaudeE2EFixture) async throws {
  let startedURL = claudeInterruptedStartedURL(fixture.space, name: "cancel")
  let command = claudeInterruptedCommand(fixture.space, name: "cancel")
  let submissionMarker = "Interrupt prompt cancel \(fixture.space.token)."
  let prompt =
    "\(submissionMarker) Use Bash once to run exactly `\(command)`. Do not do anything else until it finishes."

  try await fixture.app.submit(
    prompt,
    waitingFor: submissionMarker,
    into: fixture.space.pane
  )
  try await fixture.expect(.running, ruleIDs: ClaudeRuleID.workingTitle)
  fixture.server.releaseNextResponse()
  try await waitForClaudeCommandApproval(fixture, marker: startedURL.lastPathComponent)
  try await fixture.expect(.needsInput, ruleIDs: ClaudeRuleID.approvalForms)
  try fixture.app.press(.ctrlC, in: fixture.space.pane)
  try await fixture.expect(.needsInput, ruleIDs: ClaudeRuleID.approvalForms, timeout: 10)
  try fixture.app.press(.escape, in: fixture.space.pane)
  try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox, timeout: 10)
  #expect(!FileManager.default.fileExists(atPath: startedURL.path))
}

private func runClaudeDraftClear(_ fixture: ClaudeE2EFixture) async throws {
  let draft = "CLAUDE_DRAFT_\(fixture.space.token)"
  try fixture.app.type(draft, into: fixture.space.pane)
  try await fixture.app.waitForCapture(fixture.space.pane, contains: draft, timeout: 5)
  try fixture.app.press(.ctrlC, in: fixture.space.pane)
  try await fixture.app.waitUntil("one Ctrl+C clears Claude's draft", timeout: 5) {
    try !fixture.app.capture(fixture.space.pane)
      .replacingOccurrences(of: "\n", with: "")
      .contains(draft)
  }
  try await fixture.expect(.idle, ruleIDs: ClaudeRuleID.promptBox, timeout: 10)
}

private func stopClaude(_ fixture: ClaudeE2EFixture) async throws {
  try await fixture.app.waitUntil("repeated Ctrl+C exits Claude to the shell", timeout: 15) {
    try fixture.app.press(.ctrlC, in: fixture.space.pane)
    return try fixture.app.capture(fixture.space.pane).contains(hermeticShellPrompt)
  }
  try await fixture.app.waitUntil("Claude clears its process and native session", timeout: 15) {
    try fixture.app.debugPane(fixture.space.tab.paneID)?.agent == nil
  }
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

private enum ClaudeRuleID {
  static let approvalForms: Set<String> = [
    "bash_permission_prompt",
    "generic_permission_prompt",
    "live_blocked_form",
  ]
  static let promptBox: Set<String> = ["live_prompt_box"]
  static let workingTitle: Set<String> = ["osc_title_working"]
}

private enum ClaudeFakeCallID {
  static let lifecycleCommand = "claude-lifecycle-command"
  static let lifecycleQuestion = "claude-lifecycle-question"
  static let escapeCommand = "claude-escape-command"
  static let ctrlCCommand = "claude-ctrl-c-command"
  static let cancelCommand = "claude-cancel-command"
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
    FakeModelExchange(
      request: .messagesInputText(
        claudeInterruptedStartedURL(space, name: "cancel").lastPathComponent
      ),
      response: .messagesBash(
        callID: ClaudeFakeCallID.cancelCommand,
        command: claudeInterruptedCommand(space, name: "cancel")
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
