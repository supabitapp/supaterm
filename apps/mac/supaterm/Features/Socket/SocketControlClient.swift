import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct SocketControlClient: Sendable {
  struct Request: Equatable, Sendable {
    nonisolated let handle: UUID
    nonisolated let payload: SupatermSocketRequest
  }

  var requests: @Sendable () async -> AsyncStream<Request>
  var reply: @Sendable (UUID, SupatermSocketResponse) async -> Void
  var start: @Sendable () async throws -> String
  var stop: @Sendable () async -> Void
}

extension SocketControlClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = SocketControlRuntime.shared
    return Self(
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
    requests: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    reply: { _, _ in },
    start: {
      "/tmp/supaterm-test.sock"
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
