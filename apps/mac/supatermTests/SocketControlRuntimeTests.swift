import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSocketFeature
@testable import supaterm

struct SocketControlRuntimeTests {
  @Test
  func startRejectsRegularFileAtSocketPath() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let contents = Data("keep".utf8)
    let created = FileManager.default.createFile(atPath: socketURL.path, contents: contents)
    #expect(created)

    let runtime = SocketControlRuntime(endpointProvider: {
      socketEndpoint(path: socketURL.path)
    })

    do {
      _ = try await runtime.start()
      Issue.record("Expected start() to reject a non-socket path.")
    } catch let error as SocketControlRuntime.RuntimeError {
      #expect(error == .existingPathIsNotSocket(socketURL.path))
    } catch {
      Issue.record("Unexpected error: \(error)")
    }

    #expect(FileManager.default.fileExists(atPath: socketURL.path))
    #expect(try Data(contentsOf: socketURL) == contents)
  }

  @Test
  func startReusesStaleSocketPath() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    try createStaleSocket(at: socketURL)
    #expect(try existingNodeType(at: socketURL) == mode_t(S_IFSOCK))

    let endpoint = socketEndpoint(path: socketURL.path)
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let resolvedEndpoint = try await runtime.start()

    #expect(resolvedEndpoint == endpoint)
    #expect(try existingNodeType(at: socketURL) == mode_t(S_IFSOCK))

    await runtime.stop()
    #expect(!FileManager.default.fileExists(atPath: socketURL.path))
  }

  @Test
  func startRejectsReachableSocketAtEndpointPath() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let endpoint = socketEndpoint(path: socketURL.path)
    let firstRuntime = SocketControlRuntime(endpointProvider: { endpoint })
    let secondRuntime = SocketControlRuntime(endpointProvider: { endpoint })

    _ = try await firstRuntime.start()

    do {
      _ = try await secondRuntime.start()
      Issue.record("Expected start() to reject a reachable socket path.")
    } catch let error as SocketControlRuntime.RuntimeError {
      #expect(error == .pathAlreadyInUse(socketURL.path))
    } catch {
      Issue.record("Unexpected error: \(error)")
    }

    await firstRuntime.stop()
  }

  @Test
  func startRepairsOwnedSocketDirectoryPermissions() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketsURL = rootURL.appendingPathComponent("sockets", isDirectory: true)
    try FileManager.default.createDirectory(
      at: socketsURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o777]
    )

    let socketURL = socketsURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(endpointProvider: {
      socketEndpoint(path: socketURL.path)
    })

    _ = try await runtime.start()

    #expect(try existingPermissions(at: socketsURL) == 0o700)

    await runtime.stop()
  }

  @Test
  func startCreatesManagedDirectoryAndSocketWithPrivatePermissions() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: ["XDG_RUNTIME_DIR": rootURL.appendingPathComponent("ignored").path],
      endpointID: UUID(uuidString: "804AD5E3-9956-4E82-BD6B-C40F4EF27F90")!,
      processID: 1,
      startedAt: Date(timeIntervalSince1970: 0),
      rootDirectory: rootURL
    )!
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })

    let resolvedEndpoint = try await runtime.start()
    let managedDirectory = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)

    #expect(resolvedEndpoint == endpoint)
    #expect(endpoint.path.hasPrefix(managedDirectory.path + "/"))
    #expect(try existingPermissions(at: managedDirectory) == 0o700)
    #expect(try existingPermissions(at: URL(fileURLWithPath: endpoint.path)) == 0o600)

    await runtime.stop()
  }

  @Test
  func startUsesGuardedTestSocketRoot() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let environment = [
      "TMPDIR": rootURL.appendingPathComponent("ignored-tmp").path,
      "XDG_RUNTIME_DIR": rootURL.appendingPathComponent("ignored-xdg").path,
      SupatermCLIEnvironment.testHomeKey: rootURL.appendingPathComponent("home").path,
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: UUID(uuidString: "11AA053B-4A30-4C39-9A88-97250768746E")!,
      processID: 1,
      startedAt: Date(timeIntervalSince1970: 0)
    )!
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })

    let resolvedEndpoint = try await runtime.start()
    let managedDirectory = SupatermSocketPath.managedDirectoryURL(environment: environment)

    #expect(resolvedEndpoint == endpoint)
    #expect(endpoint.path.hasPrefix(managedDirectory.path + "/"))
    #expect(try existingPermissions(at: managedDirectory) == 0o700)

    await runtime.stop()
  }

  @Test
  func startIgnoresOverlongOrdinaryRuntimeRoots() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let longRuntimeRoot = rootURL.appendingPathComponent(
      String(repeating: "x", count: 80),
      isDirectory: true
    )
    let environment = [
      "XDG_RUNTIME_DIR": longRuntimeRoot.path,
      "TMPDIR": longRuntimeRoot.path,
      SupatermCLIEnvironment.testHomeKey: rootURL.appendingPathComponent("home").path,
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: UUID(uuidString: "5E6A9FDD-B5D8-4F46-BDA7-79C20AC2A61F")!,
      processID: 1,
      startedAt: Date(timeIntervalSince1970: 0)
    )!
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })

    let resolvedEndpoint = try await runtime.start()
    let managedDirectory = SupatermSocketPath.managedDirectoryURL(environment: environment)

    #expect(resolvedEndpoint == endpoint)
    #expect(endpoint.path.hasPrefix(managedDirectory.path + "/"))
    #expect(try existingPermissions(at: managedDirectory) == 0o700)

    await runtime.stop()
  }

  @Test
  func silentClientConnectionIsClosedAfterReadTimeout() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      clientReadTimeout: 0.2
    )
    let endpoint = try await runtime.start()
    let stream = await runtime.requests()
    let requestTask = Task {
      var iterator = stream.makeAsyncIterator()
      return await iterator.next()
    }

    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      #expect(try readByte(from: socketDescriptor) == 0)
      await runtime.stop()
      #expect(await requestTask.value == nil)
    } catch {
      await runtime.stop()
      _ = await requestTask.value
      throw error
    }
  }

  @Test
  func stoppedReaderCannotEmitIntoRestartedRuntime() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(endpointProvider: {
      socketEndpoint(path: socketURL.path)
    })
    let firstEndpoint = try await runtime.start()
    let staleSocket = try openConnectedSocket(path: firstEndpoint.path)
    defer { Darwin.close(staleSocket) }

    let staleData = try JSONEncoder().encode(SupatermSocketRequest.ping(id: "stale"))
    try writeData(staleData, to: staleSocket)
    for _ in 0..<100 {
      await Task.yield()
    }

    await runtime.stop()
    let secondEndpoint = try await runtime.start()
    let stream = await runtime.requests()
    let requestTask = Task {
      var iterator = stream.makeAsyncIterator()
      return await iterator.next()
    }

    _ = Darwin.shutdown(staleSocket, SHUT_WR)
    for _ in 0..<100 {
      await Task.yield()
    }

    let currentSocket = try openConnectedSocket(path: secondEndpoint.path)
    defer { Darwin.close(currentSocket) }
    try writeRequest(.ping(id: "current"), to: currentSocket)

    let request = try #require(await requestTask.value)
    #expect(request.payload.id == "current")
    await runtime.reply(.ok(id: "current"), to: request.handle)
    await runtime.stop()
  }

  @Test
  func requestReaderRejectsLinesOverLimit() throws {
    var sockets = [Int32](repeating: -1, count: 2)
    try #require(Darwin.socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0)
    defer {
      Darwin.close(sockets[0])
      Darwin.close(sockets[1])
    }

    try writeData(Data("123456789\n".utf8), to: sockets[0])

    #expect(
      SocketControlRuntime.readRequestLine(from: sockets[1], maximumBytes: 8) == nil
    )
  }

  @Test
  func stalledReplyDoesNotBlockOtherClients() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      clientWriteTimeout: 0.2
    )
    let endpoint = try await runtime.start()
    let stream = await runtime.requests()
    var iterator = stream.makeAsyncIterator()
    let stalledSocket = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(stalledSocket) }

    do {
      try writeRequest(.ping(id: "stalled"), to: stalledSocket)
      let stalledRequest = try #require(await iterator.next())
      let clock = ContinuousClock()
      let stalledReplyStarted = clock.now
      let stalledReplyTask = Task { @concurrent in
        await runtime.reply(
          .ok(
            id: "stalled",
            result: ["data": .string(String(repeating: "x", count: 1_048_576))]
          ),
          to: stalledRequest.handle
        )
      }
      try waitForSocketRead(stalledSocket)

      let releaseSocket = Darwin.dup(stalledSocket)
      try #require(releaseSocket >= 0)
      let releaseStalledReply = Task { @concurrent in
        defer { Darwin.close(releaseSocket) }
        do {
          try await Task.sleep(for: .seconds(2))
        } catch {
          return
        }
        _ = Darwin.shutdown(releaseSocket, SHUT_RDWR)
      }

      let responsiveSocket = try openConnectedSocket(path: endpoint.path)
      defer { Darwin.close(responsiveSocket) }
      let responsiveRequestStarted = clock.now
      try writeRequest(.ping(id: "responsive"), to: responsiveSocket)
      let responsiveRequest = try #require(await iterator.next())
      await runtime.reply(.ok(id: "responsive"), to: responsiveRequest.handle)
      let response = try #require(try readSocketResponse(from: responsiveSocket))
      let responsiveRequestDuration = responsiveRequestStarted.duration(to: clock.now)

      #expect(response.ok)
      #expect(response.id == "responsive")
      #expect(responsiveRequestDuration < .milliseconds(750))

      await stalledReplyTask.value
      releaseStalledReply.cancel()
      await releaseStalledReply.value
      #expect(stalledReplyStarted.duration(to: clock.now) < .milliseconds(750))
      await runtime.stop()
    } catch {
      await runtime.stop()
      throw error
    }
  }

  @Test(arguments: [
    SupatermSocketMethod.appAgentIntegrationSetup,
    SupatermSocketMethod.appHooksRemove,
  ])
  func agentIntegrationRequestsUseExtendedReplyTimeout(method: String) async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepRecorder = RuntimeSleepRecorder()
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      replyTimeout: .milliseconds(50),
      sleep: { duration in
        await sleepRecorder.record(duration)
      }
    )
    let endpoint = try await runtime.start()
    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      try writeRequest(
        SupatermSocketRequest(id: "agent-integration-timeout", method: method),
        to: socketDescriptor
      )

      #expect(try readByte(from: socketDescriptor) == 0)
      #expect(
        await sleepRecorder.durations()
          == [.seconds(SupatermAgentIntegrationTiming.serverReplyTimeout)]
      )
      await runtime.stop()
    } catch {
      await runtime.stop()
      throw error
    }
  }

  @Test(arguments: [
    SupatermSocketMethod.licenseActivate,
    SupatermSocketMethod.licenseDeactivate,
    SupatermSocketMethod.licenseRefresh,
  ])
  func licenseNetworkRequestsUseExtendedReplyTimeout(method: String) async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepRecorder = RuntimeSleepRecorder()
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      replyTimeout: .milliseconds(50),
      sleep: { duration in
        await sleepRecorder.record(duration)
      }
    )
    let endpoint = try await runtime.start()
    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      try writeRequest(
        SupatermSocketRequest(id: "license-timeout", method: method),
        to: socketDescriptor
      )

      #expect(try readByte(from: socketDescriptor) == 0)
      #expect(
        await sleepRecorder.durations()
          == [.seconds(SupatermLicenseTiming.serverReplyTimeout)]
      )
      await runtime.stop()
    } catch {
      await runtime.stop()
      throw error
    }
  }

  @Test
  func unrepliedRequestExpiresAndClosesClientSocket() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepRecorder = RuntimeSleepRecorder()
    let replyTimeout = Duration.milliseconds(50)
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      replyTimeout: replyTimeout,
      sleep: { duration in
        await sleepRecorder.record(duration)
      }
    )
    let endpoint = try await runtime.start()
    let stream = await runtime.requests()
    let requestTask = Task {
      var iterator = stream.makeAsyncIterator()
      return await iterator.next()
    }

    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      try writeRequest(.ping(id: "expire-1"), to: socketDescriptor)

      let request = try #require(await requestTask.value)
      #expect(try readByte(from: socketDescriptor) == 0)
      #expect(await sleepRecorder.durations() == [replyTimeout])

      await runtime.reply(.ok(id: "expire-1"), to: request.handle)
      await runtime.stop()
    } catch {
      await runtime.stop()
      _ = await requestTask.value
      throw error
    }
  }

  @Test
  func expiredBufferedRequestIsNotEmitted() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepRecorder = RuntimeSleepRecorder()
    let replyTimeout = Duration.milliseconds(50)
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      replyTimeout: replyTimeout,
      sleep: { duration in
        await sleepRecorder.record(duration)
      }
    )
    let endpoint = try await runtime.start()
    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      try writeRequest(.ping(id: "buffered-expire-1"), to: socketDescriptor)
      #expect(try readByte(from: socketDescriptor) == 0)
      #expect(await sleepRecorder.durations() == [replyTimeout])

      let stream = await runtime.requests()
      let requestTask = Task {
        var iterator = stream.makeAsyncIterator()
        return await iterator.next()
      }

      await runtime.stop()
      #expect(await requestTask.value == nil)
    } catch {
      await runtime.stop()
      throw error
    }
  }

  @Test
  func repliedRequestIsNotExpiredTwice() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepGate = RuntimeSleepGate()
    let replyTimeout = Duration.milliseconds(50)
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      replyTimeout: replyTimeout,
      sleep: { duration in
        try await sleepGate.sleep(duration)
      }
    )
    let endpoint = try await runtime.start()
    let stream = await runtime.requests()
    let requestTask = Task {
      var iterator = stream.makeAsyncIterator()
      return await iterator.next()
    }

    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    do {
      try writeRequest(.ping(id: "reply-1"), to: socketDescriptor)

      let request = try #require(await requestTask.value)
      await runtime.reply(.ok(id: "reply-1"), to: request.handle)

      let response = try #require(try readSocketResponse(from: socketDescriptor))
      #expect(response.ok)
      #expect(response.id == "reply-1")
      #expect(await sleepGate.durations() == [replyTimeout])

      await sleepGate.resumeAll()
      await runtime.stop()
    } catch {
      await sleepGate.resumeAll()
      await runtime.stop()
      _ = await requestTask.value
      throw error
    }
  }

  @Test
  func replyingCancelsTimeoutTask() async throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let sleepRecorder = RuntimeCancellableSleepRecorder()
    let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
    let runtime = SocketControlRuntime(
      endpointProvider: {
        socketEndpoint(path: socketURL.path)
      },
      sleep: { duration in
        try await sleepRecorder.sleep(duration)
      }
    )
    let endpoint = try await runtime.start()
    let stream = await runtime.requests()
    let requestTask = Task {
      var iterator = stream.makeAsyncIterator()
      return await iterator.next()
    }
    let socketDescriptor = try openConnectedSocket(path: endpoint.path)
    defer { Darwin.close(socketDescriptor) }

    try writeRequest(.ping(id: "cancel-timeout"), to: socketDescriptor)
    let request = try #require(await requestTask.value)
    #expect(await sleepRecorder.waitUntilStarted())

    await runtime.reply(.ok(id: "cancel-timeout"), to: request.handle)

    #expect(await sleepRecorder.waitUntilCancelled())
    await runtime.stop()
  }
}

private func makeTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func existingNodeType(at url: URL) throws -> mode_t {
  var fileStatus = stat()
  let status = url.path.withCString { pointer in
    lstat(pointer, &fileStatus)
  }
  guard status == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  return fileStatus.st_mode & S_IFMT
}

private func existingPermissions(at url: URL) throws -> mode_t {
  var fileStatus = stat()
  let status = url.path.withCString { pointer in
    lstat(pointer, &fileStatus)
  }
  guard status == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  return fileStatus.st_mode & 0o777
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

nonisolated private func socketEndpoint(path: String) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(uuidString: "F46D3E0B-B0C0-46CC-B14F-7C32B433179A")!,
    name: "test",
    path: path,
    pid: 1,
    startedAt: Date(timeIntervalSince1970: 0)
  )
}

private actor RuntimeSleepRecorder {
  private var recordedDurations: [Duration] = []

  func record(_ duration: Duration) {
    recordedDurations.append(duration)
  }

  func durations() -> [Duration] {
    recordedDurations
  }
}

private actor RuntimeSleepGate {
  private var continuations: [CheckedContinuation<Void, Never>] = []
  private var recordedDurations: [Duration] = []

  func sleep(_ duration: Duration) async throws {
    recordedDurations.append(duration)
    await withCheckedContinuation { continuation in
      continuations.append(continuation)
    }
  }

  func durations() -> [Duration] {
    recordedDurations
  }

  func resumeAll() {
    let pendingContinuations = continuations
    continuations.removeAll()
    for continuation in pendingContinuations {
      continuation.resume()
    }
  }
}

private actor RuntimeCancellableSleepRecorder {
  private var cancellationCount = 0
  private var startCount = 0

  func sleep(_: Duration) async throws {
    startCount += 1
    do {
      try await Task.sleep(for: .seconds(60))
    } catch {
      cancellationCount += 1
      throw error
    }
  }

  func waitUntilCancelled() async -> Bool {
    for _ in 0..<1_000 {
      if cancellationCount == 1 { return true }
      await Task.yield()
    }
    return cancellationCount == 1
  }

  func waitUntilStarted() async -> Bool {
    for _ in 0..<1_000 {
      if startCount == 1 { return true }
      await Task.yield()
    }
    return startCount == 1
  }
}

private func openConnectedSocket(
  path: String,
  responseTimeout: TimeInterval = 1
) throws -> Int32 {
  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }

  do {
    var address = try runtimeSocketAddress(path: path)
    let connectResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.connect(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard connectResult == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    var receiveTimeout = runtimeSocketTimeout(responseTimeout)
    _ = setsockopt(
      socketDescriptor,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &receiveTimeout,
      socklen_t(MemoryLayout<timeval>.size)
    )

    return socketDescriptor
  } catch {
    Darwin.close(socketDescriptor)
    throw error
  }
}

private func writeRequest(
  _ request: SupatermSocketRequest,
  to socketDescriptor: Int32
) throws {
  let data = try JSONEncoder().encode(request) + Data([0x0A])
  try writeData(data, to: socketDescriptor)
}

private func writeData(_ data: Data, to socketDescriptor: Int32) throws {
  try data.withUnsafeBytes { buffer in
    guard let baseAddress = buffer.baseAddress else { return }
    var offset = 0
    while offset < buffer.count {
      let bytesWritten = Darwin.write(
        socketDescriptor,
        baseAddress.advanced(by: offset),
        buffer.count - offset
      )
      guard bytesWritten > 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      offset += bytesWritten
    }
  }
}

private func readSocketResponse(from socketDescriptor: Int32) throws -> SupatermSocketResponse? {
  guard let responseLine = try readLine(from: socketDescriptor) else { return nil }
  guard let responseData = responseLine.data(using: .utf8) else { return nil }
  return try JSONDecoder().decode(SupatermSocketResponse.self, from: responseData)
}

private func readLine(from socketDescriptor: Int32) throws -> String? {
  var data = Data()
  var buffer = [UInt8](repeating: 0, count: 1024)

  while true {
    try waitForSocketRead(socketDescriptor)
    let bytesRead = Darwin.read(socketDescriptor, &buffer, buffer.count)
    guard bytesRead >= 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    guard bytesRead > 0 else { break }

    data.append(buffer, count: bytesRead)
    if let newlineIndex = data.firstIndex(of: 0x0A) {
      data = Data(data[..<newlineIndex])
      break
    }
  }

  guard !data.isEmpty else { return nil }
  return String(data: data, encoding: .utf8)
}

private func readByte(from socketDescriptor: Int32) throws -> Int {
  try waitForSocketRead(socketDescriptor)
  var byte = UInt8(0)
  let bytesRead = Darwin.read(socketDescriptor, &byte, 1)
  guard bytesRead >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  return bytesRead
}

private func waitForSocketRead(
  _ socketDescriptor: Int32,
  timeoutMilliseconds: Int32 = 1_000
) throws {
  var descriptor = pollfd(fd: socketDescriptor, events: Int16(POLLIN | POLLHUP), revents: 0)
  let result = Darwin.poll(&descriptor, 1, timeoutMilliseconds)
  guard result > 0 else {
    if result == 0 {
      throw POSIXError(.ETIMEDOUT)
    }
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

private func runtimeSocketAddress(path: String) throws -> sockaddr_un {
  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

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

  return address
}

private func runtimeSocketTimeout(_ interval: TimeInterval) -> timeval {
  let clampedInterval = max(0, interval)
  let seconds = __darwin_time_t(clampedInterval.rounded(.down))
  let microseconds = __darwin_suseconds_t(((clampedInterval - Double(seconds)) * 1_000_000).rounded())
  return timeval(tv_sec: seconds, tv_usec: microseconds)
}
