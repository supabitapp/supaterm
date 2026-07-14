import Foundation
import SupatermCLIShared
import Testing

@Suite(.serialized) enum SupatermE2ESuite {}

let hermeticShellStartupCommand = "exec /bin/zsh -f"

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
  let windowID: UUID
  let spaceID: UUID
  let tab: SupatermNewTabResult

  var pane: SupatermPaneTargetRequest {
    SupatermPaneTargetRequest(contextPaneID: tab.paneID)
  }
}

func withTestSpace<T>(
  _ body: (SupatermE2EApp, TestSpace) async throws -> T
) async throws -> T {
  let app = try await SharedApp.current()
  let space = try makeTestSpace(app)
  defer { try? closeTestSpace(app, spaceID: space.spaceID) }
  return try await body(app, space)
}

private func makeTestSpace(_ app: SupatermE2EApp) throws -> TestSpace {
  let token = String(UUID().uuidString.prefix(8).lowercased())
  let snapshot = try app.debugSnapshot()
  guard let window = snapshot.windows.first else {
    throw SupatermE2EError("No app window is available for a test space.")
  }

  let directory = app.stateHome.appendingPathComponent("scratch-\(token)", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

  let created = try app.send(
    .createSpace(
      SupatermCreateSpaceRequest(
        name: "e2e-\(token)",
        target: SupatermSpaceNavigationRequest(targetWindowIndex: window.index)
      )
    ),
    as: SupatermCreateSpaceResult.self
  )
  let tab = try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: hermeticShellStartupCommand,
        cwd: directory.path,
        focus: true,
        targetWindowIndex: created.target.windowIndex,
        targetSpaceIndex: created.target.spaceIndex,
        targetProjectIndex: created.projectIndex
      )
    ),
    as: SupatermNewTabResult.self
  )
  return TestSpace(
    token: token,
    directory: directory,
    windowID: window.id,
    spaceID: created.target.spaceID,
    tab: tab
  )
}

func makeTab(_ app: SupatermE2EApp, in space: TestSpace) throws -> SupatermNewTabResult {
  try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: hermeticShellStartupCommand,
        contextPaneID: space.tab.paneID,
        cwd: space.directory.path,
        focus: true
      )
    ),
    as: SupatermNewTabResult.self
  )
}

func makeSplit(_ app: SupatermE2EApp, in space: TestSpace) throws -> SupatermNewPaneResult {
  try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: hermeticShellStartupCommand,
        contextPaneID: space.tab.paneID,
        cwd: space.directory.path,
        direction: .right,
        focus: true,
        equalize: true
      )
    ),
    as: SupatermNewPaneResult.self
  )
}

private func closeTestSpace(_ app: SupatermE2EApp, spaceID: UUID) throws {
  let snapshot = try app.debugSnapshot()
  for window in snapshot.windows {
    for space in window.spaces where space.id == spaceID {
      _ = try app.send(
        .closeSpace(
          SupatermSpaceTargetRequest(
            targetWindowIndex: window.index,
            targetSpaceIndex: space.index
          )
        ),
        as: SupatermCloseSpaceResult.self
      )
      return
    }
  }
}
