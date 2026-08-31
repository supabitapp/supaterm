import Foundation
import SupatermCLIShared
import Testing

private let piE2EBinaryURL = ProcessInfo.processInfo.environment["PI_E2E_BINARY"]
  .flatMap { path in path.isEmpty ? nil : URL(fileURLWithPath: path) }
private let piE2EPackageURL = ProcessInfo.processInfo.environment["PI_E2E_PACKAGE"]
  .flatMap { path in path.isEmpty ? nil : URL(fileURLWithPath: path, isDirectory: true) }
let piE2EEnabled =
  piE2EBinaryURL
  .map { FileManager.default.isExecutableFile(atPath: $0.path) } == true
  && piE2EPackageURL
    .map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("package.json").path) }
    == true

@Suite(.enabled(if: piE2EEnabled, "Run through make mac-test-e2e."))
struct PiE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackLifecycleAndInterruptKeys() async throws {
    try await runPiLifecycle(mode: .screenRules)
  }

  @Test(.timeLimit(.minutes(5)))
  func nativeIntegrationOwnsLifecycleAndInterruptAttention() async throws {
    try await runPiLifecycle(mode: .nativeIntegration)
  }

}

@Suite(.enabled(if: piE2EEnabled, "Run through make mac-test-e2e."))
struct PiZmxE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func screenRulesTrackLifecycleAndInterruptKeys() async throws {
    try await runPiLifecycle(mode: .zmxScreenRules)
  }
}

private enum PiE2EMode {
  case nativeIntegration
  case screenRules
  case zmxScreenRules

  var usesNativeIntegration: Bool {
    self == .nativeIntegration
  }

  var zmxSessionsEnabled: Bool {
    self == .zmxScreenRules
  }
}

private struct PiE2EEnvironment {
  let executable: URL
  let package: URL
  let pathDirectories: [URL]

  init() throws {
    guard let executable = piE2EBinaryURL else {
      throw SupatermE2EError("Missing PI_E2E_BINARY.")
    }
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError("Pi is not executable at \(executable.path).")
    }
    guard let package = piE2EPackageURL else {
      throw SupatermE2EError("Missing PI_E2E_PACKAGE.")
    }
    guard FileManager.default.fileExists(atPath: package.appendingPathComponent("package.json").path)
    else {
      throw SupatermE2EError("Pi package is missing at \(package.path).")
    }
    guard let nodeDirectory = Self.nodeDirectory() else {
      throw SupatermE2EError("Pi E2E requires node in PATH.")
    }
    self.executable = executable
    self.package = package
    self.pathDirectories = [executable.deletingLastPathComponent(), nodeDirectory]
  }

  private static func nodeDirectory() -> URL? {
    ProcessInfo.processInfo.environment["PATH"]?
      .split(separator: ":")
      .map { URL(fileURLWithPath: String($0), isDirectory: true) }
      .first { directory in
        FileManager.default.isExecutableFile(
          atPath: directory.appendingPathComponent("node", isDirectory: false).path
        )
      }
  }
}

private final class PiE2EFixture {
  let app: SupatermE2EApp
  let initialProcess: SupatermAppDebugSnapshot.AgentProcess
  let mode: PiE2EMode
  let server: FakeModelServer
  let sessionID: String?
  let space: TestSpace

  private init(
    app: SupatermE2EApp,
    initialProcess: SupatermAppDebugSnapshot.AgentProcess,
    mode: PiE2EMode,
    server: FakeModelServer,
    sessionID: String?,
    space: TestSpace
  ) {
    self.app = app
    self.initialProcess = initialProcess
    self.mode = mode
    self.server = server
    self.sessionID = sessionID
    self.space = space
  }

  static func launch(mode: PiE2EMode) async throws -> PiE2EFixture {
    let environment = try PiE2EEnvironment()
    let app = try await SupatermE2EApp.launch(
      zmxSessionsEnabled: mode.zmxSessionsEnabled,
      pathDirectories: environment.pathDirectories
    )
    var server: FakeModelServer?
    do {
      let space = try await makeTestSpace(app)
      let startedServer = try FakeModelServer(script: makePiScript(space))
      server = startedServer
      let agentDirectory = app.cliHome.appendingPathComponent(".pi/agent", isDirectory: true)
      try writePiConfig(
        agentDirectory: agentDirectory,
        baseURL: startedServer.baseURL,
        mode: mode,
        package: environment.package
      )
      try app.type(
        makePiCommand(
          agentDirectory: agentDirectory,
          executable: environment.executable,
          mode: mode
        ) + "\n",
        into: space.pane
      )
      try await app.waitForCapture(space.pane, contains: "Pi can explain its own features", timeout: 60)
      let initialPhase: SupatermAppDebugSnapshot.AgentPhase =
        mode.usesNativeIntegration ? .idle : .unknown
      let initial = try await waitForPiAgent(
        app,
        mode: mode,
        phase: initialPhase,
        paneID: space.tab.paneID
      )
      let initialProcess = try requireValue(
        initial.process,
        "Pi detection has no process identity."
      )
      let sessionID = try await waitForPiSession(
        app,
        mode: mode,
        paneID: space.tab.paneID,
        phase: initialPhase
      )
      return PiE2EFixture(
        app: app,
        initialProcess: initialProcess,
        mode: mode,
        server: startedServer,
        sessionID: sessionID,
        space: space
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
    timeout: TimeInterval = 90
  ) async throws {
    if let failure = server.recordedFailure {
      throw SupatermE2EError(failure)
    }
    let agent = try await waitForPiAgent(
      app,
      mode: mode,
      phase: phase,
      paneID: space.tab.paneID,
      timeout: timeout
    )
    #expect(agent.process == initialProcess)
    let currentSessionID = try await waitForPiSession(
      app,
      mode: mode,
      paneID: space.tab.paneID,
      phase: phase,
      timeout: timeout
    )
    #expect(currentSessionID == sessionID)
  }
}

private func runPiLifecycle(mode: PiE2EMode) async throws {
  let fixture = try await PiE2EFixture.launch(mode: mode)
  defer { fixture.close() }

  try await runPiCompletedTurn(fixture)
  try await runPiEscapeTurn(fixture)
  try await runPiCtrlCTurn(fixture)
  try await stopPi(fixture)
  try fixture.server.verifyComplete()
}

private func runPiCompletedTurn(_ fixture: PiE2EFixture) async throws {
  let completion = piCompletion(fixture.space)
  try await fixture.app.submit(
    "Reply with exactly \(completion).",
    waitingFor: completion,
    into: fixture.space.pane
  )
  try await fixture.expect(.running)
  let echoedCompletionCount = try fixture.app.capture(fixture.space.pane)
    .components(separatedBy: completion).count
  fixture.server.releaseNextResponse()
  try await fixture.app.waitUntil("Pi renders its completion", timeout: 90) {
    try fixture.app.capture(fixture.space.pane)
      .components(separatedBy: completion).count > echoedCompletionCount
  }
  try await fixture.expect(fixture.mode.usesNativeIntegration ? .idle : .unknown)

  if fixture.mode.usesNativeIntegration {
    try await fixture.app.waitUntil("Pi publishes its exact completion", timeout: 30) {
      try fixture.app.debugTab(fixture.space.tab.tabID)?.latestNotificationText == completion
    }
  }
}

private func runPiEscapeTurn(_ fixture: PiE2EFixture) async throws {
  try await startPiBashTurn(fixture, name: "escape")
  try await primePiInterruptNotification(fixture, name: "escape")
  try fixture.app.press(.escape, in: fixture.space.pane)
  try await expectPiInterruptedTurn(fixture)
}

private func runPiCtrlCTurn(_ fixture: PiE2EFixture) async throws {
  try await startPiBashTurn(fixture, name: "ctrl-c")
  let draft = "PI_CTRL_C_DRAFT_\(fixture.space.token)"
  try fixture.app.type(draft, into: fixture.space.pane)
  try await fixture.app.waitForCapture(fixture.space.pane, contains: draft, timeout: 5)
  try await primePiInterruptNotification(fixture, name: "ctrl-c")
  try fixture.app.press(.ctrlC, in: fixture.space.pane)
  try await fixture.app.waitUntil("one Ctrl+C clears Pi's draft", timeout: 5) {
    try !fixture.app.capture(fixture.space.pane).contains(draft)
  }
  try Data().write(to: piHeartbeatGate(fixture.space))
  try await fixture.app.waitUntil("Pi's shell remains live after Ctrl+C", timeout: 5) {
    FileManager.default.fileExists(atPath: piHeartbeat(fixture.space).path)
  }
  try await fixture.expect(.running, timeout: 5)
  try fixture.app.press(.escape, in: fixture.space.pane)
  try await expectPiInterruptedTurn(fixture)
}

private func primePiInterruptNotification(
  _ fixture: PiE2EFixture,
  name: String
) async throws {
  guard fixture.mode.usesNativeIntegration else { return }
  let baseline = "PI_\(name.uppercased())_BASELINE_\(fixture.space.token)"
  _ = try fixture.app.send(
    .notify(SupatermNotifyRequest(body: baseline, paneID: fixture.space.tab.paneID)),
    as: SupatermNotifyResult.self
  )
  try await fixture.app.waitUntil("Pi's \(name) notification baseline is current", timeout: 5) {
    try fixture.app.debugTab(fixture.space.tab.tabID)?.latestNotificationText == baseline
  }
}

private func startPiBashTurn(_ fixture: PiE2EFixture, name: String) async throws {
  let marker = piRunningMarker(fixture.space, name: name)
  try await fixture.app.submit(
    "Run the bash command for \(name)-\(fixture.space.token) and wait for it to finish.",
    waitingFor: "\(name)-\(fixture.space.token)",
    into: fixture.space.pane
  )
  try await fixture.expect(.running)
  fixture.server.releaseNextResponse()
  try await fixture.app.waitUntil("Pi starts its \(name) bash command", timeout: 30) {
    FileManager.default.fileExists(atPath: marker.path)
  }
  try await fixture.expect(.running)
}

private func expectPiInterruptedTurn(_ fixture: PiE2EFixture) async throws {
  if fixture.mode.usesNativeIntegration {
    try await fixture.expect(.needsInput, timeout: 15)
    try await fixture.app.waitUntil("Pi publishes interruption attention", timeout: 15) {
      try fixture.app.debugTab(fixture.space.tab.tabID)?.latestNotificationText
        == "Operation aborted"
    }
  } else {
    try await fixture.expect(.unknown, timeout: 15)
  }
}

private func stopPi(_ fixture: PiE2EFixture) async throws {
  try fixture.app.press(.ctrlD, in: fixture.space.pane)
  try await fixture.app.waitForShellPrompt(fixture.space.pane)
  try await fixture.app.waitUntil("Pi clears its process and native session", timeout: 15) {
    try fixture.app.debugPane(fixture.space.tab.paneID)?.agent == nil
  }
}

private func waitForPiAgent(
  _ app: SupatermE2EApp,
  mode: PiE2EMode,
  phase: SupatermAppDebugSnapshot.AgentPhase,
  paneID: UUID,
  timeout: TimeInterval = 90
) async throws -> SupatermAppDebugSnapshot.Agent {
  try await waitForAgentSnapshot(
    app,
    paneID: paneID,
    kind: .pi,
    phase: phase,
    phaseSource: mode.usesNativeIntegration ? .native : .screen,
    status: mode.usesNativeIntegration ? .nativeAuthority : .resolved,
    ruleIDs: mode.usesNativeIntegration ? nil : piScreenRuleIDs(for: phase),
    timeout: timeout
  )
}

private func piScreenRuleIDs(for phase: SupatermAppDebugSnapshot.AgentPhase) -> Set<String>? {
  switch phase {
  case .unknown: ["default_known_agent_unknown_fallback"]
  case .running: ["working_status"]
  case .idle: nil
  case .needsInput: nil
  }
}

private func waitForPiSession(
  _ app: SupatermE2EApp,
  mode: PiE2EMode,
  paneID: UUID,
  phase: SupatermAppDebugSnapshot.AgentPhase,
  timeout: TimeInterval = 90
) async throws -> String? {
  if !mode.usesNativeIntegration {
    try await app.waitUntil("screen-only Pi has no native session", timeout: timeout) {
      try app.debugPane(paneID)?.agent?.sessionID == nil
    }
    return nil
  }

  var sessionID: String?
  try await app.waitUntil("native Pi session reaches \(phase.rawValue)", timeout: timeout) {
    guard
      let agent = try app.debugPane(paneID)?.agent,
      let boundSessionID = agent.sessionID
    else {
      return false
    }
    guard agent.kind == .pi, agent.phase == phase else { return false }
    sessionID = boundSessionID
    return true
  }
  return try requireValue(sessionID, "Pi native integration produced no session ID.")
}

private enum PiFakeCallID {
  static let ctrlC = "pi-ctrl-c"
  static let escape = "pi-escape"
}

private func makePiScript(_ space: TestSpace) -> [FakeModelExchange] {
  [
    FakeModelExchange(
      request: .messagesInputText(piCompletion(space)),
      response: .messagesText(piCompletion(space)),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesInputText("escape-\(space.token)"),
      response: .messagesToolUse(
        callID: PiFakeCallID.escape,
        name: "bash",
        input: ["command": .string(piInterruptedCommand(space, name: "escape"))]
      ),
      waitForRelease: true
    ),
    FakeModelExchange(
      request: .messagesInputText("ctrl-c-\(space.token)"),
      response: .messagesToolUse(
        callID: PiFakeCallID.ctrlC,
        name: "bash",
        input: ["command": .string(piInterruptedCommand(space, name: "ctrl-c"))]
      ),
      waitForRelease: true
    ),
  ]
}

private func writePiConfig(
  agentDirectory: URL,
  baseURL: String,
  mode: PiE2EMode,
  package: URL
) throws {
  try FileManager.default.createDirectory(at: agentDirectory, withIntermediateDirectories: true)
  let models: [String: Any] = [
    "providers": [
      "e2e": [
        "api": "anthropic-messages",
        "apiKey": "test",
        "baseUrl": baseURL,
        "models": [
          [
            "contextWindow": 32_000,
            "id": "pi-e2e",
            "input": ["text"],
            "maxTokens": 4_096,
            "name": "Pi E2E",
            "reasoning": false,
          ]
        ],
      ]
    ]
  ]
  let settings: [String: Any] = [
    "packages": mode.usesNativeIntegration ? [package.path] : []
  ]
  try writePiJSON(models, to: agentDirectory.appendingPathComponent("models.json"))
  try writePiJSON(settings, to: agentDirectory.appendingPathComponent("settings.json"))
}

func makePiNarrowTabFixture(
  app: SupatermE2EApp,
  space: TestSpace,
  tab: SupatermNewTabResult
) async throws -> NarrowAgentTabFixture {
  let environment = try PiE2EEnvironment()
  let marker = "np-\(space.token)"
  let server = try FakeModelServer(script: [
    FakeModelExchange(
      request: .messagesInputText(marker),
      response: .messagesText("PI_NARROW_DONE_\(space.token)"),
      waitForRelease: true
    )
  ])
  do {
    let agentDirectory = app.cliHome.appendingPathComponent(".pi/agent", isDirectory: true)
    try writePiConfig(
      agentDirectory: agentDirectory,
      baseURL: server.baseURL,
      mode: .screenRules,
      package: environment.package
    )
    let pane = SupatermPaneTargetRequest(paneID: tab.paneID)
    try app.type(
      makePiCommand(
        agentDirectory: agentDirectory,
        executable: environment.executable,
        mode: .screenRules
      ) + "\n",
      into: pane
    )
    try await app.waitUntil("Pi renders its startup screen", timeout: 60) {
      try app.capture(pane)
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
        .contains("Pi can explain its own features")
    }
    _ = try await waitForPiAgent(
      app,
      mode: .screenRules,
      phase: .unknown,
      paneID: tab.paneID
    )
    return NarrowAgentTabFixture(
      kind: .pi,
      pane: pane,
      prompt: "\(marker) Reply once with exactly PI_NARROW_DONE_\(space.token).",
      promptMarker: marker,
      runningRuleIDs: try requireValue(
        piScreenRuleIDs(for: .running),
        "Pi has no running screen rule."
      ),
      server: server
    )
  } catch {
    server.stop()
    throw error
  }
}

func piE2EPathDirectories() throws -> [URL] {
  try PiE2EEnvironment().pathDirectories
}

private func makePiCommand(
  agentDirectory: URL,
  executable: URL,
  mode: PiE2EMode
) -> String {
  var arguments = [
    "/usr/bin/env",
    "PI_CODING_AGENT_DIR=\(agentDirectory.path)",
    "PI_OFFLINE=1",
    "PI_SKIP_VERSION_CHECK=1",
    "PI_TELEMETRY=0",
    executable.path,
    "--offline",
    "--provider",
    "e2e",
    "--model",
    "pi-e2e",
    "--thinking",
    "off",
    "--tools",
    "bash",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-skills",
    "--no-themes",
    "--no-session",
  ]
  if !mode.usesNativeIntegration {
    arguments.append("--no-extensions")
  }
  return SupatermShellCommand.escapedCommand(arguments)
}

private func writePiJSON(_ object: Any, to url: URL) throws {
  try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    .write(to: url, options: .atomic)
}

private func piCompletion(_ space: TestSpace) -> String {
  "PI_LIFECYCLE_DONE_\(space.token)"
}

private func piRunningMarker(_ space: TestSpace, name: String) -> URL {
  space.directory.appendingPathComponent(".pi-e2e-\(name)-running", isDirectory: false)
}

private func piInterruptedCommand(_ space: TestSpace, name: String) -> String {
  let heartbeat =
    name == "ctrl-c"
    ? "; while [ ! -e \(piHeartbeatGate(space).path) ]; do /bin/sleep 0.05; done; "
      + "/usr/bin/touch \(piHeartbeat(space).path)"
    : ""
  return SupatermShellCommand.escapedCommand([
    "/bin/sh",
    "-c",
    "/usr/bin/touch \(piRunningMarker(space, name: name).path)\(heartbeat); /bin/sleep 30",
  ])
}

private func piHeartbeatGate(_ space: TestSpace) -> URL {
  space.directory.appendingPathComponent(".pi-e2e-heartbeat-gate", isDirectory: false)
}

private func piHeartbeat(_ space: TestSpace) -> URL {
  space.directory.appendingPathComponent(".pi-e2e-heartbeat", isDirectory: false)
}
