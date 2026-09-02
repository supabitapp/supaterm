import AppKit
import Foundation
import GhosttyKit
import SupatermHostClient
import Testing

@testable import supaterm

@Suite(.serialized)
@MainActor
struct HostClientIntegrationTests {
  private final class Presentation: HostWindowPresentation {
    func update(
      window: HostWindow,
      clientState: HostClientWindowState,
      projection: HostProjectionState
    ) {}

    func detach() {}
  }

  private nonisolated struct ProcessRecord: Decodable, Sendable {
    let pid: Int32
  }

  private nonisolated struct PaneRecord: Decodable, Sendable {
    let id: UUID
    let pid: UInt32
  }

  private nonisolated struct StageFailure: Error, CustomStringConvertible {
    let stage: String
    let error: any Error

    var description: String {
      "\(stage): \(error)"
    }
  }

  init() {
    _ = NSApplication.shared
    initializeGhosttyForTests()
  }

  @Test
  func rebuildsRendererWithoutReplacingTheShell() async throws {
    let stateRoot = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-host-test-\(UUID().uuidString)", isDirectory: true)
    var environment = ProcessInfo.processInfo.environment
    environment["SUPATERM_STATE_HOME"] = stateRoot.path
    environment["TMPDIR"] = FileManager.default.temporaryDirectory.path
    let bootstrap = HostProcessBootstrap(
      executableURL: hostExecutableURL,
      environment: environment
    )
    let description = try await bootstrap.prepare()
    let processRecord = try HostWireCodec.decoder.decode(
      ProcessRecord.self,
      from: Data(contentsOf: URL(fileURLWithPath: description.processRecord))
    )
    let runtimeDirectory = URL(fileURLWithPath: description.socket).deletingLastPathComponent()
    defer {
      kill(processRecord.pid, SIGTERM)
      try? FileManager.default.removeItem(at: stateRoot)
      try? FileManager.default.removeItem(at: runtimeDirectory)
    }

    let connection = try await bootstrap.connection(clientID: UUID())
    let reconciler = HostWindowReconciler { _ in Presentation() }
    let runtime = HostClientRuntime(connection: connection, windows: reconciler)
    runtime.start()
    try await waitUntil { runtime.projection.state != nil }
    #expect(await connection.isConnected)
    let initial = try #require(runtime.projection.state)
    let windowID = try #require(initial.workspace.windows.values.first?.id)
    let spaceID = try #require(initial.workspace.spaces.first?.id)
    let paneID = UUID()
    let tabID = UUID()
    let marker = "host-renderer-\(UUID().uuidString)"
    _ = try await stage("create") {
      try await connection.apply(
        command: .createTab(
          windowID: windowID,
          spaceID: spaceID,
          tabID: tabID,
          paneID: paneID,
          placement: .root(pinned: false, index: 0),
          title: nil,
          restartDirectory: nil
        ),
        expectedStructureRevision: initial.structureRevision,
        spawnSpecs: [
          paneID.uuidString.lowercased(): HostSpawnSpec(
            argv: ["/bin/sh", "-c", "printf '\(marker)'; while :; do sleep 1; done"],
            rows: 24,
            columns: 80,
            pixelWidth: 800,
            pixelHeight: 480
          )
        ]
      )
    }
    try await waitUntil {
      runtime.projection.state?.paneFacts(paneID)?.pid != nil
    }
    let pid = try #require(runtime.projection.state?.paneFacts(paneID)?.pid)

    let firstSession = HostPaneRendererSession(connection: connection, paneID: paneID)
    let firstView = try makeSurface(session: firstSession, tabID: tabID)
    firstSession.start()
    try await waitUntil { self.readText(from: firstView).contains(marker) }
    firstView.closeSurface()
    await firstSession.stop()
    try #require(
      await connection.isConnected,
      "connection after detach: \(runtime.projection.connectionState)"
    )

    let detachedPanes: [PaneRecord] = try await stage("detached list") {
      try await connection.request(
        method: "terminal.list",
        params: HostJSONValue.null
      )
    }
    #expect(detachedPanes.first(where: { $0.id == paneID })?.pid == pid)

    let secondSession = HostPaneRendererSession(connection: connection, paneID: paneID)
    let secondView = try makeSurface(session: secondSession, tabID: tabID)
    secondSession.start()
    try await waitUntil { self.readText(from: secondView).contains(marker) }
    let rebuiltPanes: [PaneRecord] = try await stage("rebuilt list") {
      try await connection.request(
        method: "terminal.list",
        params: HostJSONValue.null
      )
    }
    #expect(rebuiltPanes.first(where: { $0.id == paneID })?.pid == pid)
    secondView.closeSurface()
    await secondSession.stop()
    runtime.stop()
  }

  private var hostExecutableURL: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent(".build/supaterm-host/bin/supaterm-host")
  }

  private func makeSurface(
    session: HostPaneRendererSession,
    tabID: UUID
  ) throws -> GhosttySurfaceView {
    GhosttySurfaceView(
      runtime: try makeGhosttyRuntime(""),
      tabID: tabID,
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session.renderer
    )
  }

  private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async throws {
    for _ in 0..<500 {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("condition timed out")
  }

  private func stage<Value: Sendable>(
    _ name: String,
    operation: @escaping @Sendable () async throws -> Value
  ) async throws -> Value {
    do {
      return try await operation()
    } catch {
      throw StageFailure(stage: name, error: error)
    }
  }

  private func readText(from view: GhosttySurfaceView) -> String {
    guard let surface = view.surface else { return "" }
    var text = ghostty_text_s()
    guard ghostty_surface_read_text_tail(surface, 100, &text) else { return "" }
    defer { ghostty_surface_free_text(surface, &text) }
    return text.text.map(String.init(cString:)) ?? ""
  }
}
