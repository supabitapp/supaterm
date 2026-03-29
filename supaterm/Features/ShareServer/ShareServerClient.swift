import ComposableArchitecture
import Foundation

nonisolated struct ShareServerBridge: Sendable {
  var snapshot: @Sendable () async -> ShareWorkspaceState
  var handleMessage: @Sendable (ShareClientMessage) async throws -> Void
  var paneRuntime: @Sendable (UUID) async -> SharePaneRuntime?
  var resizePane: @Sendable (UUID, Int, Int) async throws -> Void
}

struct ShareServerAccessURL: Equatable, Sendable, Identifiable {
  let label: String
  let urlString: String

  var id: String { urlString }
}

struct ShareServerConnection: Equatable, Sendable {
  let listenAddress: String
  let port: Int
  let accessURLs: [ShareServerAccessURL]
}

enum ShareServerPhase: Equatable, Sendable {
  case stopped
  case starting(port: Int)
  case running(ShareServerConnection)
  case failed(message: String)
}

struct ShareServerSnapshot: Equatable, Sendable {
  var phase: ShareServerPhase = .stopped
}

struct ShareServerClient: Sendable {
  var observe: @Sendable () async -> AsyncStream<ShareServerSnapshot>
  var start: @Sendable (Int, UUID?) async -> Void
  var stop: @Sendable () async -> Void
}

extension ShareServerClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = ShareServerRuntime.shared
    return Self(
      observe: {
        await runtime.observe()
      },
      start: { port, _ in
        await runtime.start(port: port)
      },
      stop: {
        await runtime.stop()
      }
    )
  }()

  static let testValue = Self(
    observe: { AsyncStream { $0.finish() } },
    start: { _, _ in },
    stop: {}
  )
}

extension ShareServerClient {
  static func live(
    registry: TerminalWindowRegistry,
    runtime: ShareServerRuntime = .shared
  ) -> Self {
    return Self(
      observe: {
        await runtime.observe()
      },
      start: { port, _ in
        let sessionNames = await MainActor.run {
          registry.prepareShareSessions()
        }
        await waitForShareSessions(sessionNames)
        let bridge = ShareServerBridge(
          snapshot: {
            await MainActor.run {
              registry.shareWorkspaceState()
            }
          },
          handleMessage: { message in
            try await MainActor.run {
              try registry.handleShareMessage(message)
            }
          },
          paneRuntime: { paneID in
            await MainActor.run {
              registry.sharePaneRuntime(for: paneID)
            }
          },
          resizePane: { paneID, cols, rows in
            guard
              let runtimeInfo = await MainActor.run(body: {
                registry.sharePaneRuntime(for: paneID)
              })
            else {
              return
            }
            try ShareServerNativeBridge.sendResize(
              sessionName: runtimeInfo.sessionName,
              cols: cols,
              rows: rows
            )
          }
        )
        await runtime.start(port: port, bridge: bridge)
      },
      stop: {
        await runtime.stop()
      }
    )
  }

  private static func waitForShareSessions(_ sessionNames: [String]) async {
    guard !sessionNames.isEmpty else { return }
    let paths = sessionNames.map { ZMXClient.sessionSocketPath(for: $0) }
    for _ in 0..<40 {
      if paths.allSatisfy({ FileManager.default.fileExists(atPath: $0) }) {
        return
      }
      try? await Task.sleep(for: .milliseconds(50))
    }
  }
}

extension DependencyValues {
  var shareServerClient: ShareServerClient {
    get { self[ShareServerClient.self] }
    set { self[ShareServerClient.self] = newValue }
  }
}
