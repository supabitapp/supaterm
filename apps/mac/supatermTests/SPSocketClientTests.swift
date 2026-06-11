import Darwin
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared
@testable import SupatermSocketFeature
@testable import supaterm

struct SPSocketClientTests {
  @Test
  func sendRoundTripsRequestAndResponse() async throws {
    try await withSocketRuntime(
      replying: { request, endpoint in
        try .ok(id: request.id, encodableResult: endpoint)
      },
      run: { endpoint in
        let client = try socketClient(path: endpoint.path)
        let response = try client.send(.identity(id: "identity-1"))

        #expect(response.ok)
        #expect(response.id == "identity-1")
        #expect(try response.decodeResult(SupatermSocketEndpoint.self) == endpoint)
      }
    )
  }

  @Test
  func sendThrowsWhenServerNeverReplies() async throws {
    try await withSocketRuntime(
      replying: { _, _ in nil },
      run: { endpoint in
        let client = try socketClient(path: endpoint.path, responseTimeout: 0.2)
        let start = Date()

        do {
          _ = try client.send(.ping(id: "ping-1"))
          Issue.record("Expected send to time out.")
        } catch {
          #expect(Date().timeIntervalSince(start) < 2)
        }
      }
    )
  }

  @Test
  func connectFailsFastWhenNothingListens() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let client = try socketClient(path: socketURL.path, connectRetryTimeout: 0.2)
    let start = Date()

    do {
      _ = try client.send(.ping(id: "ping-1"))
      Issue.record("Expected send to fail without a listening socket.")
    } catch {
      #expect(Date().timeIntervalSince(start) < 1)
    }
  }

  @Test
  func connectRejectsRegularFileAtSocketPath() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let created = FileManager.default.createFile(
      atPath: socketURL.path,
      contents: Data("occupied".utf8)
    )
    #expect(created)

    let client = try socketClient(path: socketURL.path)

    do {
      _ = try client.send(.ping(id: "ping-1"))
      Issue.record("Expected send to reject a regular file.")
    } catch {
      #expect(error.localizedDescription.contains("non-socket"))
    }
  }

  @Test
  func connectSucceedsWhenServerBindsDuringRetryWindow() async throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let endpoint = socketClientEndpoint(path: socketURL.path)
    let socketPath = socketURL.path
    let sendTask = Task.detached {
      let client = try socketClient(path: socketPath, connectRetryTimeout: 1)
      return try client.send(.identity(id: "late-identity"))
    }

    try await Task.sleep(nanoseconds: 100_000_000)

    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startSocketResponder(
      runtime: runtime,
      endpoint: endpoint,
      replying: { request, endpoint in
        try .ok(id: request.id, encodableResult: endpoint)
      }
    )

    do {
      let response = try await sendTask.value
      #expect(response.ok)
      #expect(try response.decodeResult(SupatermSocketEndpoint.self) == endpoint)
      responder.cancel()
      await runtime.stop()
      try? FileManager.default.removeItem(at: rootURL)
    } catch {
      responder.cancel()
      await runtime.stop()
      try? FileManager.default.removeItem(at: rootURL)
      throw error
    }
  }

  @Test
  func probeIdentityReturnsStaleWhenConnectRefused() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)

    let client = try socketClient(path: socketURL.path)

    #expect(client.probeIdentity() == .stale)
  }

  @Test
  func probeIdentityReturnsReachableForMatchingEndpoint() async throws {
    try await withSocketRuntime(
      replying: { request, endpoint in
        try .ok(id: request.id, encodableResult: endpoint)
      },
      run: { endpoint in
        let client = try socketClient(path: endpoint.path)

        #expect(client.probeIdentity() == .reachable(endpoint))
      }
    )
  }

  @Test
  func probeIdentityReturnsIgnoredOnPathMismatch() async throws {
    try await withSocketRuntime(
      replying: { request, endpoint in
        let mismatchedEndpoint = SupatermSocketEndpoint(
          id: endpoint.id,
          name: endpoint.name,
          path: endpoint.path + ".other",
          pid: endpoint.pid,
          startedAt: endpoint.startedAt
        )
        return try .ok(id: request.id, encodableResult: mismatchedEndpoint)
      },
      run: { endpoint in
        let client = try socketClient(path: endpoint.path)

        #expect(client.probeIdentity() == .ignored)
      }
    )
  }

  @Test
  func socketResolutionStrategyUsesExplicitPathWithoutDiscoveryWhenNeeded() {
    let strategy = SPSocketResolutionStrategy.make(
      explicitSocketPath: "/tmp/explicit.sock",
      environmentSocketPath: "/tmp/environment.sock",
      environmentPathStatus: nil,
      discoveryPolicy: .whenNeeded
    )

    #expect(strategy == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: false))
  }

  @Test
  func socketResolutionStrategyUsesReachableEnvironmentPathWithoutDiscovery() {
    let endpoint = socketClientEndpoint(path: "/tmp/environment.sock")
    let strategy = SPSocketResolutionStrategy.make(
      explicitSocketPath: nil,
      environmentSocketPath: endpoint.path,
      environmentPathStatus: .reachable(endpoint),
      discoveryPolicy: .whenNeeded
    )

    #expect(
      strategy
        == SPSocketResolutionStrategy(
          environmentPath: endpoint.path,
          discoversManagedSockets: false
        )
    )
  }

  @Test(arguments: [
    SupatermManagedSocketCandidateStatus?.none,
    .some(.stale),
  ])
  func socketResolutionStrategyDiscoversWhenEnvironmentPathIsMissingOrStale(
    status: SupatermManagedSocketCandidateStatus?
  ) {
    let strategy = SPSocketResolutionStrategy.make(
      explicitSocketPath: nil,
      environmentSocketPath: "/tmp/environment.sock",
      environmentPathStatus: status,
      discoveryPolicy: .whenNeeded
    )

    #expect(strategy == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true))
  }

  @Test
  func socketResolutionStrategyAlwaysDiscoversWithoutChangingExplicitPrecedence() {
    let strategy = SPSocketResolutionStrategy.make(
      explicitSocketPath: "/tmp/explicit.sock",
      environmentSocketPath: "/tmp/environment.sock",
      environmentPathStatus: nil,
      discoveryPolicy: .always
    )

    #expect(strategy == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true))
  }
}

private func withSocketRuntime(
  replying reply:
    @escaping @Sendable (
      SupatermSocketRequest,
      SupatermSocketEndpoint
    ) async throws -> SupatermSocketResponse?,
  run body: (SupatermSocketEndpoint) throws -> Void
) async throws {
  let rootURL = try makeSocketClientTemporaryDirectory()
  let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
  let endpoint = socketClientEndpoint(path: socketURL.path)
  let runtime = SocketControlRuntime(endpointProvider: { endpoint })
  let responder = try await startSocketResponder(runtime: runtime, endpoint: endpoint, replying: reply)

  do {
    try body(endpoint)
    responder.cancel()
    await runtime.stop()
    try? FileManager.default.removeItem(at: rootURL)
  } catch {
    responder.cancel()
    await runtime.stop()
    try? FileManager.default.removeItem(at: rootURL)
    throw error
  }
}

@discardableResult
private func startSocketResponder(
  runtime: SocketControlRuntime,
  endpoint: SupatermSocketEndpoint,
  replying reply:
    @escaping @Sendable (
      SupatermSocketRequest,
      SupatermSocketEndpoint
    ) async throws -> SupatermSocketResponse?
) async throws -> Task<Void, Never> {
  _ = try await runtime.start()
  return Task.detached(priority: .utility) {
    let stream = await runtime.requests()
    for await request in stream {
      if Task.isCancelled {
        return
      }
      if let response = try? await reply(request.payload, endpoint) {
        await runtime.reply(response, to: request.handle)
      }
    }
  }
}

nonisolated private func socketClient(
  path: String,
  connectRetryTimeout: TimeInterval = 0.3,
  responseTimeout: TimeInterval = 0.3
) throws -> SPSocketClient {
  try SPSocketClient(
    path: path,
    connectRetryInterval: 0.02,
    connectRetryTimeout: connectRetryTimeout,
    responseTimeout: responseTimeout
  )
}

private func makeSocketClientTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func createStaleSocket(at url: URL) throws {
  _ = url.path.withCString(unlink)

  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  defer { Darwin.close(socketDescriptor) }

  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

  let path = url.path
  let maxLength = MemoryLayout.size(ofValue: address.sun_path)
  guard path.utf8.count < maxLength else {
    throw POSIXError(.ENAMETOOLONG)
  }

  path.withCString { pointer in
    withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
      let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
      strncpy(buffer, pointer, maxLength - 1)
    }
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

nonisolated private func socketClientEndpoint(path: String) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(uuidString: "F46D3E0B-B0C0-46CC-B14F-7C32B433179A")!,
    name: "test",
    path: path,
    pid: 1,
    startedAt: Date(timeIntervalSince1970: 0)
  )
}
