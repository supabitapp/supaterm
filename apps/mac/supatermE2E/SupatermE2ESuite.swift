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
  startupCommand: SupatermTerminalStartup? = hermeticShellStartup
) throws -> SupatermNewPaneResult {
  try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: startupCommand,
        cwd: space.directory.path,
        direction: .right,
        focus: true,
        equalize: true,
        target: .pane(space.tab.paneID)
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

func installAgentHook(
  _ agent: SupatermAgentKind,
  runner: SPBinaryRunner,
  socketPath: String,
  workspace: URL,
  app: SupatermE2EApp
) async throws {
  let arguments = SupatermManagedHookCommand.installArguments(for: agent) + ["--socket", socketPath]
  var lastResult: SPBinaryResult?
  do {
    try await app.waitUntil("the \(agent.notificationTitle) hook installer replies", timeout: 45) {
      lastResult = try runner.run(arguments, cwd: workspace, timeout: 15)
      return lastResult?.exitCode == 0
    }
  } catch {
    throw SupatermE2EError(
      "\(error)\n--- last hook install ---\n\(String(describing: lastResult))"
    )
  }
}

func requireValue<Wrapped>(_ value: Wrapped?, _ message: String) throws -> Wrapped {
  guard let value else { throw SupatermE2EError(message) }
  return value
}
