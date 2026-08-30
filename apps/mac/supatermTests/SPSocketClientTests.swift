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
  func sendRejectsEncodedRequestsBeforeConnecting() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let startup = SupatermTerminalStartup.shell(
      String(repeating: "\u{1}", count: 3 * 1_024 * 1_024)
    )
    let request = try SupatermSocketRequest.newTab(
      SupatermNewTabRequest(
        startupCommand: startup,
        focus: false,
        target: .space(UUID())
      )
    )

    #expect(startup.isValid)
    #expect(try JSONEncoder().encode(request).count > SupatermSocketRequest.maximumEncodedBytes)
    let client = try socketClient(
      path: rootURL.appendingPathComponent("missing.sock").path,
      connectRetryTimeout: 0
    )

    let error = try #require(throws: (any Error).self) {
      try client.send(request)
    }
    #expect(
      error.localizedDescription
        == "Supaterm socket request exceeds \(SupatermSocketRequest.maximumEncodedBytes) bytes."
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
  func environmentSocketResolutionWaitsForTheAppToStartListening() async throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let endpoint = socketClientEndpoint(path: socketURL.path)
    let socketPath = socketURL.path
    let resolutionTask = Task.detached {
      SPSocketSelection.resolve(
        explicitPath: nil,
        instance: nil,
        environment: [SupatermCLIEnvironment.socketPathKey: socketPath],
        rootDirectory: rootURL
      )
    }

    try await Task.sleep(for: .milliseconds(400))

    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startSocketResponder(
      runtime: runtime,
      endpoint: endpoint,
      replying: { request, endpoint in
        try .ok(id: request.id, encodableResult: endpoint)
      }
    )

    let diagnostics = await resolutionTask.value
    #expect(diagnostics.resolvedTarget?.path == endpoint.path)
    #expect(diagnostics.resolvedTarget?.source == .environmentPath)

    responder.cancel()
    await runtime.stop()
    try? FileManager.default.removeItem(at: rootURL)
  }

  @Test
  func environmentSocketResolutionWaitsForTheAppToReply() async throws {
    try await withSocketRuntime(
      replying: { request, endpoint in
        try await Task.sleep(for: .milliseconds(400))
        return try .ok(id: request.id, encodableResult: endpoint)
      },
      run: { endpoint in
        let diagnostics = SPSocketSelection.resolve(
          explicitPath: nil,
          instance: nil,
          environment: [SupatermCLIEnvironment.socketPathKey: endpoint.path],
          rootDirectory: URL(fileURLWithPath: endpoint.path).deletingLastPathComponent()
        )

        #expect(diagnostics.resolvedTarget?.path == endpoint.path)
        #expect(diagnostics.resolvedTarget?.source == .environmentPath)
      }
    )
  }

  @Test
  func conflictingRuntimeEnvironmentsDiscoverTheSameManagedEndpoint() async throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let appEnvironment = [
      "TMPDIR": rootURL.appendingPathComponent("app-tmp").path,
      "XDG_RUNTIME_DIR": rootURL.appendingPathComponent("app-xdg").path,
      SupatermCLIEnvironment.testHomeKey: rootURL.appendingPathComponent("app-home").path,
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let cliEnvironment = [
      "TMPDIR": rootURL.appendingPathComponent("cli-tmp").path,
      "XDG_RUNTIME_DIR": rootURL.appendingPathComponent("cli-xdg").path,
      SupatermCLIEnvironment.testHomeKey: rootURL.appendingPathComponent("cli-home").path,
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let endpoint = try #require(
      SupatermProcessSocketEndpoint.make(
        environment: appEnvironment,
        processID: 99,
        startedAt: Date(timeIntervalSince1970: 0)
      )
    )
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startSocketResponder(
      runtime: runtime,
      endpoint: endpoint,
      replying: { request, endpoint in
        try .ok(id: request.id, encodableResult: endpoint)
      }
    )

    let diagnostics = SPSocketSelection.resolve(
      explicitPath: nil,
      instance: nil,
      environment: cliEnvironment
    )

    #expect(diagnostics.discoveredEndpoints == [endpoint])
    #expect(diagnostics.resolvedTarget?.path == endpoint.path)
    #expect(diagnostics.resolvedTarget?.source == .discoveredSingleton)

    responder.cancel()
    await runtime.stop()
  }

  @Test
  func staleRemovalRejectsSocketOutsideManagedDirectory() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)
    try FileManager.default.createDirectory(
      at: managedDirectoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let socketURL = rootURL.appendingPathComponent("outside.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)

    #expect(
      !SPSocketSelection.removeManagedSocketPath(
        socketURL.path,
        rootDirectory: rootURL
      )
    )
    #expect(FileManager.default.fileExists(atPath: socketURL.path))
  }

  @Test
  func staleRemovalRemovesOwnedSocketInsidePrivateManagedDirectory() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)
    try FileManager.default.createDirectory(
      at: managedDirectoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let socketURL = managedDirectoryURL.appendingPathComponent("stale.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)

    #expect(
      SPSocketSelection.removeManagedSocketPath(
        socketURL.path,
        rootDirectory: rootURL
      )
    )
    #expect(!FileManager.default.fileExists(atPath: socketURL.path))
  }

  @Test
  func staleRemovalRejectsSocketInSharedManagedDirectory() throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)
    try FileManager.default.createDirectory(
      at: managedDirectoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let socketURL = managedDirectoryURL.appendingPathComponent("stale.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: managedDirectoryURL.path
    )

    #expect(
      !SPSocketSelection.removeManagedSocketPath(
        socketURL.path,
        rootDirectory: rootURL
      )
    )
    #expect(FileManager.default.fileExists(atPath: socketURL.path))
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
