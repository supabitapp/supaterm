import Darwin
import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct SessionHostLifecycleTests {
    @Test(.timeLimit(.minutes(5)))
    func directProcessSurvivesRelaunchAndItsPaneClosesOnExit() async throws {
      let app = try await SupatermE2EApp.launch(sessionPersistenceEnabled: true)
      defer { app.terminate() }

      let process = try await createWaitingDirectProcess(app, name: "sessionHost-relaunch")
      #expect(kill(process.processID, 0) == 0)
      try await app.waitForPersistedStateQuiescence(containing: [process.paneID.uuidString])

      try await app.quit()
      #expect(kill(process.processID, 0) == 0)
      try await app.relaunch()
      try await app.waitForDebugSnapshot("the direct process pane reattaches") { snapshot in
        snapshot.windows
          .flatMap(\.spaces)
          .flatMap(\.flattenedTabs)
          .flatMap(\.panes)
          .contains { $0.id == process.paneID }
      }
      #expect(try readProcessID(process.processIDFile) == process.processID)
      #expect(kill(process.processID, 0) == 0)

      try Data().write(to: process.stopFile)
      try await app.waitUntil("the finished direct process pane closes") {
        try app.debugPane(process.paneID) == nil
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func finishedDirectProcessDoesNotRestoreAsAShell() async throws {
      let app = try await SupatermE2EApp.launch(sessionPersistenceEnabled: true)
      defer { app.terminate() }

      let process = try await createWaitingDirectProcess(app, name: "sessionHost-finished")
      let shellSpace = try app.send(
        .createSpace(SupatermCreateSpaceRequest(color: nil, name: "sessionHost-finished-shell")),
        as: SupatermCreateSpaceResult.self
      )
      #expect(shellSpace.isSelectedSpace)
      try await app.waitForReadyPane(SupatermPaneTargetRequest(paneID: shellSpace.paneID))
      try await app.waitForPersistedStateQuiescence(
        containing: [process.paneID.uuidString, shellSpace.paneID.uuidString]
      )

      try await app.quit()
      try Data().write(to: process.stopFile)
      try await app.waitUntil("the direct process exits while the app is closed") {
        kill(process.processID, 0) != 0
      }
      try await app.relaunch()
      try await app.waitUntil("the finished direct process pane stays closed") {
        try app.debugPane(process.paneID) == nil
      }
    }
  }
}

private struct WaitingDirectProcess {
  let paneID: UUID
  let processID: pid_t
  let processIDFile: URL
  let stopFile: URL
}

private func createWaitingDirectProcess(
  _ app: SupatermE2EApp,
  name: String
) async throws -> WaitingDirectProcess {
  let directory = app.stateHome.appendingPathComponent(name, isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let processIDFile = directory.appendingPathComponent("pid")
  let stopFile = directory.appendingPathComponent("stop")
  let command = [
    "/bin/sh",
    "-c",
    "printf '%s\\n' \"$$\" > \"$1\"; while [ ! -e \"$2\" ]; do /bin/sleep 0.1; done",
    name,
    processIDFile.path,
    stopFile.path,
  ]
  let space = try app.send(
    .createSpace(SupatermCreateSpaceRequest(color: nil, name: name)),
    as: SupatermCreateSpaceResult.self
  )
  let tab = try app.send(
    .newTab(
      SupatermNewTabRequest(
        startupCommand: .exec(command, searchPath: "/usr/bin:/bin"),
        cwd: directory.path,
        focus: true,
        target: .space(space.target.spaceID)
      )
    ),
    as: SupatermNewTabResult.self
  )
  try await app.waitUntil("the direct process writes its process ID") {
    try readProcessID(processIDFile) != nil
  }
  return WaitingDirectProcess(
    paneID: tab.paneID,
    processID: try #require(try readProcessID(processIDFile)),
    processIDFile: processIDFile,
    stopFile: stopFile
  )
}

private func readProcessID(_ url: URL) throws -> pid_t? {
  guard let value = try? String(contentsOf: url, encoding: .utf8),
    let processID = pid_t(value.trimmingCharacters(in: .whitespacesAndNewlines))
  else {
    return nil
  }
  return processID
}
