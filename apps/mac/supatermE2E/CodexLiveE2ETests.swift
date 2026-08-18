import Foundation
import SupatermCLIShared
import Testing

private let liveCodexE2EEnabled = FileManager.default.fileExists(
  atPath: CodexLiveEnvironment.configurationURL.path
)

@Suite(
  .enabled(
    if: liveCodexE2EEnabled,
    "Run the live Codex tests through make mac-test-e2e."
  )
)
struct CodexLiveE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackEveryRootStateAndInterrupt() async throws {
    try await runCodexLifecycle(mode: .screenRules)
  }

  @Test(.timeLimit(.minutes(5)))
  func hooksAugmentScreenRulesAcrossEveryRootStateAndInterrupt() async throws {
    try await runCodexLifecycle(mode: .hooks)
  }
}

private enum CodexLiveMode {
  case hooks
  case screenRules

  var hooksEnabled: Bool {
    self == .hooks
  }
}

private struct CodexLiveEnvironment {
  static let configurationURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent(".build/live-codex-e2e.json", isDirectory: false)

  let apiKey: String
  let baseURL: String
  let executable: URL

  init() throws {
    let data = try Data(contentsOf: Self.configurationURL)
    let configuration = try JSONDecoder().decode(Configuration.self, from: data)
    apiKey = try Self.decode(configuration.apiKey, name: "CODEX_BALANCER_API_KEY")
    baseURL = try Self.decode(configuration.baseURL, name: "CODEX_BALANCER_BASE_URL")
    let executablePath = try Self.decode(configuration.executable, name: "CODEX_E2E_BINARY")
    executable = URL(fileURLWithPath: executablePath)
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError("Codex is not executable at \(executable.path).")
    }
  }

  private static func decode(_ encoded: String, name: String) throws -> String {
    guard let data = Data(base64Encoded: encoded),
      let value = String(data: data, encoding: .utf8),
      !value.isEmpty
    else {
      throw SupatermE2EError("Missing \(name).")
    }
    return value
  }

  private struct Configuration: Decodable {
    let apiKey: String
    let baseURL: String
    let executable: String
  }
}

private final class CodexLiveFixture {
  let app: SupatermE2EApp
  let mode: CodexLiveMode
  let space: TestSpace
  let initialProcess: SupatermAgentExplainResult.Process
  var sessionID: String?

  private init(
    app: SupatermE2EApp,
    mode: CodexLiveMode,
    space: TestSpace,
    initialProcess: SupatermAgentExplainResult.Process,
    sessionID: String?
  ) {
    self.app = app
    self.mode = mode
    self.space = space
    self.initialProcess = initialProcess
    self.sessionID = sessionID
  }

  static func launch(mode: CodexLiveMode) async throws -> CodexLiveFixture {
    let environment = try CodexLiveEnvironment()
    let app = try await SupatermE2EApp.launch(
      environment: ["CODEX_BALANCER_API_KEY": environment.apiKey],
      pathDirectories: [environment.executable.deletingLastPathComponent()]
    )
    do {
      let space = try await makeTestSpace(app)
      try writeConfig(
        baseURL: environment.baseURL,
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
        try await installCodexHooks(
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
      let initialProcess = try await waitForAgentExplain(
        app,
        target: space.pane,
        phase: .idle
      ).process.require("Codex detection has no process identity.")
      try await app.waitForCapture(space.pane, contains: "gpt-5.6-luna low", timeout: 60)
      let sessionID = try app.debugPane(space.tab.paneID)?.agent?.sessionID
      if !mode.hooksEnabled {
        #expect(try app.debugPane(space.tab.paneID)?.agent == nil)
      }
      return CodexLiveFixture(
        app: app,
        mode: mode,
        space: space,
        initialProcess: initialProcess,
        sessionID: sessionID
      )
    } catch {
      app.terminate()
      throw error
    }
  }

  func close() {
    try? closeTestSpace(app, spaceID: space.spaceID)
    app.terminate()
  }

  func expect(
    _ phase: SupatermAgentExplainResult.Phase,
    timeout: TimeInterval = 90
  ) async throws {
    let result = try await waitForAgentExplain(app, target: space.pane, phase: phase, timeout: timeout)
    #expect(result.process == initialProcess)
    if mode.hooksEnabled {
      var nextSessionID: String?
      try await app.waitUntil("the native Codex session reaches \(phase.rawValue)", timeout: timeout) {
        guard let agent = try app.debugPane(space.tab.paneID)?.agent else { return false }
        let matchesSession = sessionID.map { agent.sessionID == $0 } ?? true
        guard
          agent.kind == .codex
            && matchesSession
            && agent.phase.rawValue == phase.rawValue
        else { return false }
        nextSessionID = agent.sessionID
        return true
      }
      sessionID = sessionID ?? nextSessionID
    } else {
      #expect(try app.debugPane(space.tab.paneID)?.agent == nil)
    }
  }

  func approve() throws {
    try app.press(.enter, in: space.pane)
  }

  private static func writeConfig(
    baseURL: String,
    hooksEnabled: Bool,
    home: URL,
    workspace: URL
  ) throws {
    let codexHome = home.appendingPathComponent(".codex", isDirectory: true)
    try FileManager.default.createDirectory(at: codexHome, withIntermediateDirectories: true)
    let config = """
      approval_policy = "untrusted"
      model = "gpt-5.6-luna"
      model_provider = "balancer"
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

      [model_providers.balancer]
      base_url = \(tomlString(baseURL))
      env_key = "CODEX_BALANCER_API_KEY"
      name = "OpenAI"
      request_max_retries = 100
      stream_idle_timeout_ms = 900000
      stream_max_retries = 100
      supports_websockets = true
      websocket_connect_timeout_ms = 60000

      [projects.\(tomlString(workspace.path))]
      trust_level = "trusted"

      [shell_environment_policy]
      inherit = "all"
      """
    try config.write(
      to: codexHome.appendingPathComponent("config.toml", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
  }
}

private func installCodexHooks(
  runner: SPBinaryRunner,
  socketPath: String,
  workspace: URL,
  app: SupatermE2EApp
) async throws {
  let arguments =
    SupatermManagedHookCommand.installArguments(for: .codex) + ["--socket", socketPath]
  var lastResult: SPBinaryResult?
  do {
    try await app.waitUntil("the Codex hook installer replies", timeout: 45) {
      lastResult = try runner.run(arguments, cwd: workspace, timeout: 15)
      return lastResult?.exitCode == 0
    }
  } catch {
    throw SupatermE2EError(
      "\(error)\n--- last hook install ---\n\(String(describing: lastResult))"
    )
  }
}

private func runCodexLifecycle(mode: CodexLiveMode) async throws {
  let fixture = try await CodexLiveFixture.launch(mode: mode)
  defer { fixture.close() }

  try await runCompletedTurn(fixture)
  try await runInterruptedTurn(fixture, key: .escape, name: "escape")
  try await runInterruptedTurn(fixture, key: .ctrlC, name: "ctrl-c")
}

private func runCompletedTurn(_ fixture: CodexLiveFixture) async throws {
  let token = fixture.space.token
  let question = "Proceed with lifecycle check \(token)?"
  let completion = "LIFECYCLE_DONE_\(token)"
  let marker = fixture.space.directory.appendingPathComponent("lifecycle-\(token)")
  let command = SupatermShellCommand.escapedCommand(["/usr/bin/touch", marker.path])
  let prompt = [
    "First call request_user_input with one question.",
    "Use header \"E2E\", question \"\(question)\", and two options named \"Proceed\" and \"Stop\".",
    "After the answer, use the shell tool once to run exactly `\(command)`.",
    "After it finishes, reply with exactly `\(completion)`.",
    "Do not call any other tool.",
  ].joined(separator: " ")

  try fixture.app.submit(prompt, into: fixture.space.pane)
  try await fixture.expect(.running)
  try await fixture.app.waitForCapture(fixture.space.pane, contains: question, timeout: 90)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await waitForCommandApproval(fixture, marker: marker.lastPathComponent)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await fixture.app.waitUntil("the approved lifecycle command runs", timeout: 60) {
    FileManager.default.fileExists(atPath: marker.path)
  }
  try await fixture.app.waitForCapture(fixture.space.pane, contains: completion, timeout: 90)
  try await fixture.expect(.idle)

  if fixture.mode.hooksEnabled {
    try await fixture.app.waitUntil("the Codex Stop hook publishes completion", timeout: 60) {
      try fixture.app.debugTab(fixture.space.tab.tabID)?.latestNotificationText == completion
    }
  } else {
    #expect(try fixture.app.debugTab(fixture.space.tab.tabID)?.latestNotificationText == nil)
  }
}

private func runInterruptedTurn(
  _ fixture: CodexLiveFixture,
  key: SupatermInputKey,
  name: String
) async throws {
  let marker = "\(name)-running-\(fixture.space.token)"
  let command = SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/bin/echo \(SupatermShellCommand.escapedToken(marker)) >/dev/null; /bin/sleep 30",
  ])
  let prompt =
    "Use the shell tool once to run exactly `\(command)`. Do not do anything else until it finishes."

  try fixture.app.submit(prompt, into: fixture.space.pane)
  try await fixture.expect(.running)
  try await waitForCommandApproval(fixture, marker: marker)
  try await fixture.expect(.needsInput)
  try fixture.approve()
  try await fixture.expect(.running)
  try fixture.app.press(key, in: fixture.space.pane)
  try await fixture.expect(.idle)
  try await fixture.app.waitForCapture(
    fixture.space.pane,
    contains: "Conversation interrupted",
    timeout: 60
  )
}

private func waitForAgentExplain(
  _ app: SupatermE2EApp,
  target: SupatermPaneTargetRequest,
  phase: SupatermAgentExplainResult.Phase,
  timeout: TimeInterval = 90
) async throws -> SupatermAgentExplainResult {
  var lastResult: SupatermAgentExplainResult?
  do {
    try await app.waitUntil("Codex screen rules resolve \(phase.rawValue)", timeout: timeout) {
      let result = try app.agentExplain(target)
      lastResult = result
      return result.mode == .fallback
        && result.status == .resolved
        && result.agent?.id == "codex"
        && result.agent?.phase == phase
    }
  } catch {
    throw SupatermE2EError(
      "\(error)\n--- last agent explain ---\n\(String(describing: lastResult))"
        + "\n--- pane capture ---\n\((try? app.capture(target)) ?? "unavailable")"
    )
  }
  return try lastResult.require("Codex screen rules produced no result.")
}

private func waitForCommandApproval(
  _ fixture: CodexLiveFixture,
  marker: String
) async throws {
  var lastCapture = ""
  do {
    try await fixture.app.waitUntil("the current command approval is ready", timeout: 90) {
      lastCapture = try fixture.app.capture(fixture.space.pane)
        .replacingOccurrences(of: "\n", with: "")
      return lastCapture.components(separatedBy: marker).count >= 3
    }
  } catch {
    throw SupatermE2EError("\(error)\n--- pane capture ---\n\(lastCapture)")
  }
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

extension Optional {
  fileprivate func require(_ message: String) throws -> Wrapped {
    guard let self else { throw SupatermE2EError(message) }
    return self
  }
}
