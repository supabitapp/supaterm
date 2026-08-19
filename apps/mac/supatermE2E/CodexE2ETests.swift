import Foundation
import SupatermCLIShared
import Testing

private let codexE2EBinaryURL = ProcessInfo.processInfo.environment["CODEX_E2E_BINARY"]
  .flatMap { path in path.isEmpty ? nil : URL(fileURLWithPath: path) }
private let codexE2EEnabled =
  codexE2EBinaryURL
  .map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false

@Suite(.enabled(if: codexE2EEnabled, "Run through make mac-test-e2e."))
struct CodexE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackEveryRootStateAndInterrupt() async throws {
    try await runCodexLifecycle(mode: .screenRules)
  }

  @Test(.timeLimit(.minutes(5)))
  func hooksAugmentScreenRulesAcrossEveryRootStateAndInterrupt() async throws {
    try await runCodexLifecycle(mode: .hooks)
  }

  @Test(.timeLimit(.minutes(5)))
  func trustPromptBlocksUntilApproved() async throws {
    try await runCodexTrustPrompt()
  }
}

@Suite(.enabled(if: codexE2EEnabled, "Run through make mac-test-e2e."))
struct CodexZmxE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackEveryRootStateAndInterrupt() async throws {
    try await runCodexLifecycle(mode: .zmxScreenRules)
  }
}

private enum CodexE2EMode {
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

private struct CodexE2EEnvironment {
  let executable: URL

  init() throws {
    guard let executable = codexE2EBinaryURL else {
      throw SupatermE2EError("Missing CODEX_E2E_BINARY.")
    }
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError("Codex is not executable at \(executable.path).")
    }
    self.executable = executable
  }
}

private final class CodexE2EFixture {
  let app: SupatermE2EApp
  let mode: CodexE2EMode
  let server: FakeModelServer
  let space: TestSpace
  let initialProcess: SupatermAppDebugSnapshot.AgentProcess
  var sessionID: String?

  private init(
    app: SupatermE2EApp,
    mode: CodexE2EMode,
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

  static func launch(mode: CodexE2EMode) async throws -> CodexE2EFixture {
    let environment = try CodexE2EEnvironment()
    let app = try await SupatermE2EApp.launch(
      zmxSessionsEnabled: mode.zmxSessionsEnabled,
      environment: ["CODEX_E2E_API_KEY": "test"],
      pathDirectories: [environment.executable.deletingLastPathComponent()]
    )
    var server: FakeModelServer?
    do {
      let space = try await makeTestSpace(app)
      let startedServer = try FakeModelServer(script: makeCodexScript(space))
      server = startedServer
      try writeConfig(
        baseURL: startedServer.responsesBaseURL,
        hooksEnabled: mode.hooksEnabled,
        home: app.cliHome,
        workspace: space.directory
      )
      if mode.hooksEnabled {
        let runner = SPBinaryRunner(
          app: app,
          tabID: space.tab.tabID,
          paneID: space.tab.paneID
        )
        try await installAgentHook(
          .codex,
          runner: runner,
          socketPath: app.socketPath,
          workspace: space.directory,
          app: app
        )
      }
      let command = SupatermShellCommand.escapedCommand([
        "/usr/bin/env",
        "CODEX_HOME=\(app.cliHome.appendingPathComponent(".codex").path)",
        environment.executable.path,
        "--strict-config",
        "--no-alt-screen",
        "--cd",
        space.directory.path,
      ])
      try app.type(command + "\n", into: space.pane)
      let initial = try await waitForAgentSnapshot(
        app,
        paneID: space.tab.paneID,
        kind: .codex,
        phase: .idle,
        ruleIDs: CodexRuleID.idleTitle
      )
      let initialProcess = try requireValue(
        initial.process,
        "Codex detection has no process identity."
      )
      try await app.waitForCapture(space.pane, contains: "gpt-5.6-luna low", timeout: 60)
      return CodexE2EFixture(
        app: app,
        mode: mode,
        server: startedServer,
        space: space,
        initialProcess: initialProcess,
        sessionID: nil
      )
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
    let agent = try await waitForAgentSnapshot(
      app,
      paneID: space.tab.paneID,
      kind: .codex,
      phase: phase,
      ruleIDs: ruleIDs,
      timeout: timeout
    )
    #expect(agent.process == initialProcess)
    if mode.hooksEnabled {
      var nextSessionID: String?
      try await app.waitUntil("the native Codex session remains bound", timeout: timeout) {
        guard
          let agent = try app.debugPane(space.tab.paneID)?.agent,
          let boundSessionID = agent.sessionID
        else {
          return false
        }
        let matchesSession = sessionID.map { boundSessionID == $0 } ?? true
        guard agent.kind == .codex, matchesSession else { return false }
        nextSessionID = boundSessionID
        return true
      }
      sessionID = sessionID ?? nextSessionID
    } else {
      try await app.waitUntil("the pane has no native Codex session", timeout: timeout) {
        guard let pane = try app.debugPane(space.tab.paneID) else { return false }
        return pane.agent?.sessionID == nil
      }
    }
  }

  func approve() throws {
    try app.press(.enter, in: space.pane)
  }

  static func writeConfig(
    baseURL: String,
    hooksEnabled: Bool,
    home: URL,
    workspace: URL,
    trustsWorkspace: Bool = true
  ) throws {
    let codexHome = home.appendingPathComponent(".codex", isDirectory: true)
    try FileManager.default.createDirectory(at: codexHome, withIntermediateDirectories: true)
    let config = """
      approval_policy = "untrusted"
      model = "gpt-5.6-luna"
      model_provider = "e2e"
      model_reasoning_effort = "low"
      model_verbosity = "low"
      sandbox_mode = "read-only"
      suppress_unstable_features_warning = true
      web_search = "disabled"

      [analytics]
      enabled = false

      [features]
      apps = false
      default_mode_request_user_input = true
      goals = false
      hooks = \(hooksEnabled)
      memories = false
      multi_agent_v2 = false
      prevent_idle_sleep = false

      [feedback]
      enabled = false

      [model_providers.e2e]
      base_url = \(tomlString(baseURL))
      env_key = "CODEX_E2E_API_KEY"
      name = "E2E"
      request_max_retries = 0
      stream_idle_timeout_ms = 120000
      stream_max_retries = 0
      supports_websockets = false

      [shell_environment_policy]
      inherit = "all"
      """ + (trustsWorkspace ? """


      [projects.\(tomlString(workspace.path))]
      trust_level = "trusted"
      """ : "")
    try config.write(
      to: codexHome.appendingPathComponent("config.toml", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
  }
}

private enum CodexRuleID {
  static let blockers: Set<String> = ["osc_title_blocked", "live_strong_blocker"]
  static let idleTitle: Set<String> = ["osc_title_idle"]
  static let trustPrompt: Set<String> = ["trust_directory", "osc_title_blocked"]
  static let working: Set<String> = ["osc_title_working", "screen_working_fallback"]
}

private func runCodexTrustPrompt() async throws {
  let environment = try CodexE2EEnvironment()
  let app = try await SupatermE2EApp.launch(
    environment: ["CODEX_E2E_API_KEY": "test"],
    pathDirectories: [environment.executable.deletingLastPathComponent()]
  )
  var spaceID: UUID?
  var server: FakeModelServer?
  defer {
    if let spaceID {
      try? closeTestSpace(app, spaceID: spaceID)
    }
    app.terminate()
    server?.stop()
  }

  let space = try await makeTestSpace(app)
  spaceID = space.spaceID
  let startedServer = try FakeModelServer(script: [])
  server = startedServer
  try CodexE2EFixture.writeConfig(
    baseURL: startedServer.responsesBaseURL,
    hooksEnabled: false,
    home: app.cliHome,
    workspace: space.directory,
    trustsWorkspace: false
  )
  let command = SupatermShellCommand.escapedCommand([
    "/usr/bin/env",
    "CODEX_HOME=\(app.cliHome.appendingPathComponent(".codex").path)",
    environment.executable.path,
    "--strict-config",
    "--no-alt-screen",
    "--cd",
    space.directory.path,
  ])
  try app.type(command + "\n", into: space.pane)
  _ = try await waitForAgentSnapshot(
    app,
    paneID: space.tab.paneID,
    kind: .codex,
    phase: .needsInput,
    ruleIDs: CodexRuleID.trustPrompt
  )
  try app.press(.enter, in: space.pane)
  _ = try await waitForAgentSnapshot(
    app,
    paneID: space.tab.paneID,
    kind: .codex,
    phase: .idle,
    ruleIDs: CodexRuleID.idleTitle
  )
  try startedServer.verifyComplete()
}

private func runCodexLifecycle(mode: CodexE2EMode) async throws {
  let fixture = try await CodexE2EFixture.launch(mode: mode)
  defer { fixture.close() }

  try await runCompletedTurn(fixture)
  try await runInterruptedTurn(fixture, key: .escape, name: "escape")
  try await runInterruptedTurn(fixture, key: .ctrlC, name: "ctrl-c")
  try await runCancelledTurn(fixture)
  try await runCodexDraftClear(fixture)
  try await stopCodex(fixture)
  try fixture.server.verifyComplete()
}

private func runCompletedTurn(_ fixture: CodexE2EFixture) async throws {
  let question = lifecycleQuestion(fixture.space)
  let completion = lifecycleCompletion(fixture.space)
  let marker = lifecycleMarker(fixture.space)
  let command = lifecycleCommand(fixture.space)
  let prompt = [
    marker,
    "First call request_user_input with one question.",
    "Use header \"E2E\", question \"\(question)\", and two options named \"Proceed\" and \"Stop\".",
    "After the answer, use the shell tool once to run exactly `\(command)`.",
    "After it finishes, reply with exactly `\(completion)`.",
    "Do not call any other tool.",
  ].joined(separator: " ")

  try await fixture.app.submit(prompt, waitingFor: marker, into: fixture.space.pane)
  try await fixture.expect(.running, ruleIDs: CodexRuleID.working)
  fixture.server.releaseNextResponse()
  try await fixture.app.waitForCapture(fixture.space.pane, contains: question, timeout: 90)
  try await fixture.expect(.needsInput, ruleIDs: CodexRuleID.blockers)
  try fixture.approve()
  try await waitForCommandApproval(fixture, marker: marker)
  try await fixture.expect(.needsInput, ruleIDs: CodexRuleID.blockers)
  try fixture.approve()
  try await fixture.expect(.running, ruleIDs: CodexRuleID.working)
  let completionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: completion).count
  fixture.server.releaseNextResponse()
  try await fixture.app.waitUntil("Codex prints the lifecycle completion", timeout: 90) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: completion).count > completionCount
  }
  try await fixture.expect(.idle, ruleIDs: CodexRuleID.idleTitle)
}

private func runInterruptedTurn(
  _ fixture: CodexE2EFixture,
  key: SupatermInputKey,
  name: String
) async throws {
  let marker = interruptedMarker(fixture.space, name: name)
  let command = interruptedCommand(fixture.space, name: name)
  let prompt =
    "\(marker) Use the shell tool once to run exactly `\(command)`. Do not do anything else until it finishes."

  try await fixture.app.submit(
    prompt,
    waitingFor: marker,
    into: fixture.space.pane
  )
  try await fixture.expect(.running, ruleIDs: CodexRuleID.working)
  fixture.server.releaseNextResponse()
  try await waitForCommandApproval(fixture, marker: marker)
  try await fixture.expect(.needsInput, ruleIDs: CodexRuleID.blockers)
  let workingCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: "esc to interrupt").count
  try fixture.approve()
  try await fixture.expect(.running, ruleIDs: CodexRuleID.working)
  try await fixture.app.waitUntil("Codex starts the \(name) command", timeout: 10) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: "esc to interrupt").count > workingCount
  }
  let interruptionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: "Conversation interrupted").count
  try fixture.app.press(key, in: fixture.space.pane)
  try await fixture.app.waitUntil("Codex records the \(name) interruption", timeout: 10) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: "Conversation interrupted").count > interruptionCount
  }
  try await fixture.expect(.idle, ruleIDs: CodexRuleID.idleTitle, timeout: 10)
}

private func runCancelledTurn(_ fixture: CodexE2EFixture) async throws {
  let marker = interruptedMarker(fixture.space, name: "cancel")
  let startedURL = codexCancelStartedURL(fixture.space)
  let command = codexCancelCommand(fixture.space)
  let prompt =
    "\(marker) Use the shell tool once to run exactly `\(command)`. Do not do anything else until it finishes."

  try await fixture.app.submit(
    prompt,
    waitingFor: marker,
    into: fixture.space.pane
  )
  try await fixture.expect(.running, ruleIDs: CodexRuleID.working)
  fixture.server.releaseNextResponse()
  try await waitForCommandApproval(fixture, marker: startedURL.lastPathComponent)
  try await fixture.expect(.needsInput, ruleIDs: CodexRuleID.blockers)
  let interruptionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: "Conversation interrupted").count
  try fixture.app.press(.ctrlC, in: fixture.space.pane)
  try await fixture.app.waitUntil("Codex records the cancel interruption", timeout: 10) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: "Conversation interrupted").count > interruptionCount
  }
  try await fixture.expect(.idle, ruleIDs: CodexRuleID.idleTitle, timeout: 10)
  #expect(!FileManager.default.fileExists(atPath: startedURL.path))
}

private func runCodexDraftClear(_ fixture: CodexE2EFixture) async throws {
  let draft = "CODEX_DRAFT_\(fixture.space.token)"
  try fixture.app.type(draft, into: fixture.space.pane)
  try await fixture.app.waitForCapture(fixture.space.pane, contains: draft, timeout: 5)
  try fixture.app.press(.ctrlC, in: fixture.space.pane)
  try await fixture.app.waitUntil("one Ctrl+C clears Codex's draft", timeout: 5) {
    try !fixture.app.capture(fixture.space.pane)
      .replacingOccurrences(of: "\n", with: "")
      .contains(draft)
  }
  try await fixture.expect(.idle, ruleIDs: CodexRuleID.idleTitle, timeout: 10)
}

private func stopCodex(_ fixture: CodexE2EFixture) async throws {
  try await fixture.app.waitUntil("repeated Ctrl+C exits Codex to the shell", timeout: 15) {
    try fixture.app.press(.ctrlC, in: fixture.space.pane)
    return try fixture.app.capture(fixture.space.pane).contains(hermeticShellPrompt)
  }
  try await fixture.app.waitUntil("Codex clears its process and native session", timeout: 15) {
    try fixture.app.debugPane(fixture.space.tab.paneID)?.agent == nil
  }
}

private func waitForCommandApproval(
  _ fixture: CodexE2EFixture,
  marker: String
) async throws {
  var lastCapture = ""
  do {
    try await fixture.app.waitUntil("the current command approval is ready", timeout: 20) {
      lastCapture = try fixture.app.capture(fixture.space.pane)
      return lastCapture.contains(marker)
        && lastCapture.contains("Would you like to run the following command?")
    }
  } catch {
    throw SupatermE2EError("\(error)\n--- pane capture ---\n\(lastCapture)")
  }
}

private enum CodexFakeCallID {
  static let lifecycleCommand = "lifecycle-command"
  static let lifecycleQuestion = "lifecycle-question"
  static let escapeCommand = "escape-command"
  static let ctrlCCommand = "ctrl-c-command"
  static let cancelCommand = "cancel-command"
}

private func makeCodexScript(_ space: TestSpace) -> [FakeModelExchange] {
  [
    FakeModelExchange(
      request: .responsesInputText(lifecycleQuestion(space)),
      response: .responsesRequestUserInput(
        callID: CodexFakeCallID.lifecycleQuestion,
        question: lifecycleQuestion(space)
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .responsesFunctionOutput(callID: CodexFakeCallID.lifecycleQuestion),
      response: .responsesShellCommand(
        callID: CodexFakeCallID.lifecycleCommand,
        command: lifecycleCommand(space)
      )
    ),
    FakeModelExchange(
      request: .responsesFunctionOutput(callID: CodexFakeCallID.lifecycleCommand),
      response: .responsesMessage(lifecycleCompletion(space)),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .responsesInputText(interruptedMarker(space, name: "escape")),
      response: .responsesShellCommand(
        callID: CodexFakeCallID.escapeCommand,
        command: interruptedCommand(space, name: "escape")
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .responsesInputText(interruptedMarker(space, name: "ctrl-c")),
      response: .responsesShellCommand(
        callID: CodexFakeCallID.ctrlCCommand,
        command: interruptedCommand(space, name: "ctrl-c")
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .responsesInputText(interruptedMarker(space, name: "cancel")),
      response: .responsesShellCommand(
        callID: CodexFakeCallID.cancelCommand,
        command: codexCancelCommand(space)
      ),
      waitForRelease: true
    ),
  ]
}

private func lifecycleQuestion(_ space: TestSpace) -> String {
  "Proceed with lifecycle check \(space.token)?"
}

private func lifecycleCompletion(_ space: TestSpace) -> String {
  "LIFECYCLE_DONE_\(space.token)"
}

private func lifecycleMarker(_ space: TestSpace) -> String {
  "lifecycle-\(space.token)"
}

private func lifecycleCommand(_ space: TestSpace) -> String {
  SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/bin/sleep 0.1; /usr/bin/true \(lifecycleMarker(space))",
  ])
}

private func interruptedMarker(_ space: TestSpace, name: String) -> String {
  "\(name)-running-\(space.token)"
}

private func interruptedCommand(_ space: TestSpace, name: String) -> String {
  SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/usr/bin/true \(interruptedMarker(space, name: name)); /bin/sleep 30",
  ])
}

private func codexCancelStartedURL(_ space: TestSpace) -> URL {
  space.directory.appendingPathComponent("codex-cancel-started-\(space.token)")
}

private func codexCancelCommand(_ space: TestSpace) -> String {
  SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/usr/bin/touch \(codexCancelStartedURL(space).path); /bin/sleep 30",
  ])
}

private func tomlString(_ value: String) -> String {
  "\""
    + value
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\"", with: "\\\"")
    .replacingOccurrences(of: "\n", with: "\\n")
    .replacingOccurrences(of: "\r", with: "\\r")
    .replacingOccurrences(of: "\t", with: "\\t")
    + "\""
}
