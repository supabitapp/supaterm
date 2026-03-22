import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct SocketControlClient: Sendable {
  struct Request: Equatable, Sendable {
    nonisolated let handle: UUID
    nonisolated let payload: SupatermSocketRequest
  }

  var currentEndpoint: @Sendable () async -> SupatermSocketEndpoint?
  var requests: @Sendable () async -> AsyncStream<Request>
  var reply: @Sendable (UUID, SupatermSocketResponse) async -> Void
  var start: @Sendable () async throws -> SupatermSocketEndpoint
  var stop: @Sendable () async -> Void
}

extension SocketControlClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = SocketControlRuntime.shared
    return Self(
      currentEndpoint: {
        await runtime.currentEndpoint()
      },
      requests: {
        await runtime.requests()
      },
      reply: { handle, response in
        await runtime.reply(response, to: handle)
      },
      start: {
        try await runtime.start()
      },
      stop: {
        await runtime.stop()
      }
    )
  }()

  static let testValue = Self(
    currentEndpoint: {
      nil
    },
    requests: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    reply: { _, _ in },
    start: {
      .init(
        id: UUID(uuidString: "8D630A04-61B5-48E8-9D7E-F7E0BB8B9B16")!,
        name: "test",
        path: "/tmp/supaterm-test.sock",
        pid: 1,
        startedAt: .init(timeIntervalSince1970: 0)
      )
    },
    stop: {}
  )
}

extension DependencyValues {
  var socketControlClient: SocketControlClient {
    get { self[SocketControlClient.self] }
    set { self[SocketControlClient.self] = newValue }
  }
}
