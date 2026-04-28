import ComposableArchitecture
import Foundation
import SupatermCLIShared

public struct SocketControlClient: Sendable {
  public struct Request: Equatable, Sendable {
    public nonisolated let handle: UUID
    public nonisolated let payload: SupatermSocketRequest

    public nonisolated init(
      handle: UUID,
      payload: SupatermSocketRequest
    ) {
      self.handle = handle
      self.payload = payload
    }
  }

  public var currentEndpoint: @MainActor @Sendable () async -> SupatermSocketEndpoint?
  public var requests: @MainActor @Sendable () async -> AsyncStream<Request>
  public var reply: @MainActor @Sendable (UUID, SupatermSocketResponse) async -> Void
  public var start: @MainActor @Sendable () async throws -> SupatermSocketEndpoint
  public var stop: @MainActor @Sendable () async -> Void

  public nonisolated init(
    currentEndpoint: @escaping @MainActor @Sendable () async -> SupatermSocketEndpoint?,
    requests: @escaping @MainActor @Sendable () async -> AsyncStream<Request>,
    reply: @escaping @MainActor @Sendable (UUID, SupatermSocketResponse) async -> Void,
    start: @escaping @MainActor @Sendable () async throws -> SupatermSocketEndpoint,
    stop: @escaping @MainActor @Sendable () async -> Void
  ) {
    self.currentEndpoint = currentEndpoint
    self.requests = requests
    self.reply = reply
    self.start = start
    self.stop = stop
  }
}

extension SocketControlClient: DependencyKey {
  public nonisolated static let liveValue: Self = {
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

  public nonisolated static let testValue = Self(
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
      SupatermSocketEndpoint(
        id: UUID(uuidString: "8D630A04-61B5-48E8-9D7E-F7E0BB8B9B16")!,
        name: "test",
        path: "/tmp/supaterm-test.sock",
        pid: 1,
        startedAt: Date(timeIntervalSince1970: 0)
      )
    },
    stop: {}
  )
}

extension DependencyValues {
  public var socketControlClient: SocketControlClient {
    get { self[SocketControlClient.self] }
    set { self[SocketControlClient.self] = newValue }
  }
}
