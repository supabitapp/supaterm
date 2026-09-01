import Foundation
import SupatermCLIShared
import Testing

@Suite(.serialized) enum SupatermE2ESuite {}

let hermeticShellPrompt = "SUPATERM_E2E_READY"
let hermeticShellArguments = [
  "/usr/bin/env", "PS1=\(hermeticShellPrompt)", "/bin/zsh", "-f",
]
let hermeticShellStartup = SupatermTerminalStartup.shell(
  SupatermShellCommand.escapedCommand(hermeticShellArguments)
)

private nonisolated(unsafe) var sharedAppAtExit: SupatermE2EApp?

enum SharedApp {
  private static let launchTask = Task<SupatermE2EApp, Error> {
    let app = try await SupatermE2EApp.launch()
    sharedAppAtExit = app
    atexit {
      sharedAppAtExit?.terminate()
    }
    return app
  }

  static func current() async throws -> SupatermE2EApp {
    try await launchTask.value
  }
}

struct TestSpace {
  let token: String
  let directory: URL
  let spaceID: UUID
  let tab: SupatermNewTabResult

  var pane: SupatermPaneTargetRequest {
    SupatermPaneTargetRequest(paneID: tab.paneID)
  }
}

func withTestSpace<T>(
  _ body: (SupatermE2EApp, TestSpace) async throws -> T
) async throws -> T {
  let app = try await SharedApp.current()
  let space = try await makeTestSpace(app)
  defer { try? closeTestSpace(app, spaceID: space.spaceID) }
  return try await body(app, space)
}

func makeTestSpace(_ app: SupatermE2EApp) async throws -> TestSpace {
  let token = String(UUID().uuidString.prefix(8).lowercased())
  let snapshot = try app.debugSnapshot()
  guard snapshot.windows.first != nil else {
    throw SupatermE2EError("No app window is available for a test space.")
  }

  let directory = app.stateHome.appendingPathComponent("scratch-\(token)", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

  let created = try app.send(
    .createSpace(
      SupatermCreateSpaceRequest(color: nil, name: "e2e-\(token)")
    ),
    as: SupatermCreateSpaceResult.self
  )
  let tab = try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: hermeticShellStartup,
        cwd: directory.path,
        focus: true,
        target: .space(created.target.spaceID)
      )
    ),
    as: SupatermNewTabResult.self
  )
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: tab.paneID))
  return TestSpace(
    token: token,
    directory: directory,
    spaceID: created.target.spaceID,
    tab: tab
  )
}

func makeTab(_ app: SupatermE2EApp, in space: TestSpace) throws -> SupatermNewTabResult {
  try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: hermeticShellStartup,
        cwd: space.directory.path,
        focus: true,
        target: .pane(space.tab.paneID)
      )
    ),
    as: SupatermNewTabResult.self
  )
}

func makeSplit(
  _ app: SupatermE2EApp,
  in space: TestSpace,
  startupCommand: SupatermTerminalStartup? = hermeticShellStartup,
  target: SupatermPaneTargetRequest? = nil
) throws -> SupatermNewPaneResult {
  try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: startupCommand,
        cwd: space.directory.path,
        direction: .right,
        focus: true,
        equalize: true,
        target: .pane(target?.paneID ?? space.tab.paneID)
      )
    ),
    as: SupatermNewPaneResult.self
  )
}

func closeTestSpace(_ app: SupatermE2EApp, spaceID: UUID) throws {
  let snapshot = try app.debugSnapshot()
  for window in snapshot.windows {
    for space in window.spaces where space.id == spaceID {
      _ = try app.send(
        .closeSpace(
          SupatermSpaceTargetRequest(spaceID: space.id)
        ),
        as: SupatermCloseSpaceResult.self
      )
      return
    }
  }
}

func setupAgentIntegrations(
  runner: SPBinaryRunner,
  socketPath: String,
  workspace: URL
) throws {
  let arguments = ["agent", "setup", "--socket", socketPath]
  do {
    try requireSuccessfulSPResult(
      runner.run(
        arguments,
        cwd: workspace,
        timeout: SupatermAgentIntegrationTiming.clientResponseTimeout
          * TimeInterval(SupatermAgentKind.managedIntegrationCases.count) + 5
      )
    )
  } catch {
    throw SupatermE2EError("sp agent setup failed: \(error)")
  }
}

func requireValue<Wrapped>(_ value: Wrapped?, _ message: String) throws -> Wrapped {
  guard let value else { throw SupatermE2EError(message) }
  return value
}

func waitForAgentSnapshot(
  _ app: SupatermE2EApp,
  paneID: UUID,
  kind: SupatermAgentKind,
  phase: SupatermAppDebugSnapshot.AgentPhase,
  phaseSource: SupatermAppDebugSnapshot.AgentPhaseSource = .screen,
  status: SupatermAppDebugSnapshot.AgentDetectionStatus = .resolved,
  ruleIDs: Set<String>? = nil,
  timeout: TimeInterval = 90
) async throws -> SupatermAppDebugSnapshot.Agent {
  var lastPane: SupatermAppDebugSnapshot.Pane?
  do {
    try await app.waitUntil(
      "\(kind.rawValue) detection resolves \(phase.rawValue)",
      timeout: timeout
    ) {
      let pane = try app.debugPane(paneID)
      lastPane = pane
      guard let pane, let agent = pane.agent else { return false }
      return pane.agentStatus == status
        && agent.kind == kind
        && agent.phaseSource == phaseSource
        && agent.phase == phase
        && ruleIDs.map { agent.ruleID.map($0.contains) ?? false } ?? true
    }
  } catch {
    let capture = (try? app.capture(SupatermPaneTargetRequest(paneID: paneID))) ?? "unavailable"
    throw SupatermE2EError(
      "\(error)\n--- last pane snapshot ---\n\(String(describing: lastPane))"
        + "\n--- pane capture ---\n\(capture)"
    )
  }
  return try requireValue(lastPane?.agent, "\(kind.rawValue) detection produced no agent.")
}

func assertAgentPhaseHolds(
  _ app: SupatermE2EApp,
  paneID: UUID,
  kind: SupatermAgentKind,
  phase: SupatermAppDebugSnapshot.AgentPhase,
  for duration: TimeInterval = 1.2
) async throws {
  let deadline = Date().addingTimeInterval(duration)
  while Date() < deadline {
    let pane = try requireValue(
      try app.debugPane(paneID),
      "The pane vanished while holding \(phase.rawValue)."
    )
    guard let agent = pane.agent, agent.kind == kind, agent.phase == phase else {
      throw SupatermE2EError(
        "Detection left \(phase.rawValue) while an ambiguous screen was open."
          + "\n--- pane snapshot ---\n\(String(describing: pane))"
      )
    }
    try await Task.sleep(for: .milliseconds(100))
  }
}
