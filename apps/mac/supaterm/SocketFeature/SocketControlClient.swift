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
  public var isPending: @MainActor @Sendable (UUID) async -> Bool
  public var requests: @MainActor @Sendable () async -> AsyncStream<Request>
  public var reply: @MainActor @Sendable (UUID, SupatermSocketResponse) async -> Void
  public var start: @MainActor @Sendable () async throws -> SupatermSocketEndpoint
  public var stop: @MainActor @Sendable () async -> Void

  public nonisolated init(
    currentEndpoint: @escaping @MainActor @Sendable () async -> SupatermSocketEndpoint?,
    isPending: @escaping @MainActor @Sendable (UUID) async -> Bool,
    requests: @escaping @MainActor @Sendable () async -> AsyncStream<Request>,
    reply: @escaping @MainActor @Sendable (UUID, SupatermSocketResponse) async -> Void,
    start: @escaping @MainActor @Sendable () async throws -> SupatermSocketEndpoint,
    stop: @escaping @MainActor @Sendable () async -> Void
  ) {
    self.currentEndpoint = currentEndpoint
    self.isPending = isPending
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
      isPending: { handle in
        await runtime.isPending(handle)
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
    currentEndpoint: unimplemented("SocketControlClient.currentEndpoint", placeholder: nil),
    isPending: unimplemented("SocketControlClient.isPending", placeholder: false),
    requests: unimplemented(
      "SocketControlClient.requests",
      placeholder: AsyncStream { $0.finish() }
    ),
    reply: unimplemented("SocketControlClient.reply"),
    start: unimplemented("SocketControlClient.start"),
    stop: unimplemented("SocketControlClient.stop")
  )
}

extension DependencyValues {
  public var socketControlClient: SocketControlClient {
    get { self[SocketControlClient.self] }
    set { self[SocketControlClient.self] = newValue }
  }
}
