import Darwin
import Dispatch
import Foundation
import Network
import Testing

@testable import SupatermCLIShared

extension SupatermHostConnectionTests {
  @Test
  func canceledAttachCleanupPrecedesNextAttachForTheTerminal() async throws {
    let didReadFirstAttach = AsyncStream<Void>.makeStream()
    let observedSecondAttachBlocked = AsyncStream<Void>.makeStream()
    let checkForSecondAttach = DispatchSemaphore(value: 0)
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let firstAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let secondAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174002")
    let terminal = testTerminalInfo(id: terminalID)
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let firstAttach = try readClientEnvelope(socket)
      guard case .attach(let requestedTerminalID, _, _) = firstAttach.body,
        requestedTerminalID == terminalID
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      didReadFirstAttach.continuation.yield()
      guard checkForSecondAttach.wait(timeout: .now() + 2) == .success else {
        throw SupatermHostWireTestError.timeout
      }
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      observedSecondAttachBlocked.continuation.yield()
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: firstAttach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: firstAttachmentID,
            boundarySequence: 0,
            nextInputSequence: 0
          )
        )
      )
      let cleanup = try readClientEnvelope(socket)
      guard
        cleanup.body
          == .detach(
            terminalID: terminalID,
            attachmentID: firstAttachmentID
          )
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: cleanup.requestID, body: .ack)
      )
      let secondAttach = try readClientEnvelope(socket)
      guard case .attach(let requestedTerminalID, _, _) = secondAttach.body,
        requestedTerminalID == terminalID
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: secondAttach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: secondAttachmentID,
            boundarySequence: 0,
            nextInputSequence: 0
          )
        )
      )
      return [firstAttach, cleanup, secondAttach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    let firstAttach = Task { try await connection.attach(terminalID: terminalID) }
    for await _ in didReadFirstAttach.stream.prefix(1) {}
    firstAttach.cancel()
    await #expect(throws: CancellationError.self) {
      try await firstAttach.value
    }
    let secondAttach = Task { try await connection.attach(terminalID: terminalID) }
    checkForSecondAttach.signal()
    for await _ in observedSecondAttachBlocked.stream.prefix(1) {}

    #expect(try await secondAttach.value.attachmentID == secondAttachmentID)
    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func resyncRevokesOneAttachmentAndKeepsConnectionUsable() async throws {
    let revokedTerminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let activeTerminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174010")
    let revokedAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let activeAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174011")
    let revokedTerminal = testTerminalInfo(id: revokedTerminalID)
    let activeTerminal = testTerminalInfo(id: activeTerminalID)
    let server = try SupatermHostWireTestServer { socket in
      try serveResyncIsolation(
        socket,
        revokedTerminal: revokedTerminal,
        revokedAttachmentID: revokedAttachmentID,
        activeTerminal: activeTerminal,
        activeAttachmentID: activeAttachmentID
      )
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: revokedTerminalID)
    _ = try await connection.attach(terminalID: activeTerminalID)

    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: revokedTerminalID,
          attachmentID: revokedAttachmentID,
          sequence: 4,
          data: Data("queued".utf8)
        )
    )
    #expect(
      try await connection.nextEvent()
        == .resyncRequired(
          terminalID: revokedTerminalID,
          attachmentID: revokedAttachmentID
        )
    )
    #expect(try await connection.list().isEmpty)
    await #expect(
      throws: SupatermHostConnectionError.protocolViolation(
        "input has no matching attachment"
      )
    ) {
      try await connection.input(
        terminalID: revokedTerminalID,
        attachmentID: revokedAttachmentID,
        data: Data([1])
      )
    }
    try await connection.input(
      terminalID: activeTerminalID,
      attachmentID: activeAttachmentID,
      data: Data([1])
    )

    await connection.close()
    #expect(try await server.result.value.count == 4)
  }

  @Test
  func rejectsAttachReplaySegmentRegression() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      for segment in [SupatermHostAttachReplaySegment.title, .vt] {
        try writeHostEnvelope(
          socket,
          SupatermHostEnvelope(
            requestID: attach.requestID,
            body: .attachReplay(
              attachmentID: attachmentID,
              segment: segment,
              data: Data([1])
            )
          )
        )
      }
      usleep(50_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.protocolViolation(
        "attach replay segment order regressed"
      )
    ) {
      try await connection.attach(terminalID: terminalID)
    }

    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func rejectsAttachReplayBeyondRequestByteCap() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attachReplay(
            attachmentID: attachmentID,
            segment: .vt,
            data: Data([0, 1, 2, 3])
          )
        )
      )
      usleep(50_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test,
      attachReplayCapacity: 3
    )

    await #expect(throws: SupatermHostConnectionError.attachReplayBufferOverflow(3)) {
      try await connection.attach(terminalID: terminalID)
    }

    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func rejectsAttachReplayCapacityBeyondProtocolLimit() async {
    let capacity = supatermHostMaximumAttachReplayBytes + 1
    await #expect(
      throws: SupatermHostConnectionError.invalidAttachReplayCapacity(capacity)
    ) {
      try await SupatermHostConnection.connect(
        socketURL: URL(fileURLWithPath: "/missing/host.sock"),
        role: .test,
        attachReplayCapacity: capacity
      )
    }
  }

  @Test
  func rejectsReplayWithoutRequestCorrelation() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .attachReplay(
            attachmentID: attachmentID,
            segment: .vt,
            data: Data([1])
          )
        )
      )
      usleep(50_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.protocolViolation("response has no request ID")
    ) {
      try await connection.attach(terminalID: terminalID)
    }

    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func attachErrorDiscardsReplayAndLeavesConnectionUsable() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attachReplay(
            attachmentID: attachmentID,
            segment: .vt,
            data: Data("discarded".utf8)
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .error(code: .terminalInUse, message: "writer already attached")
        )
      )
      let list = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [attach, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.remote(
        code: .terminalInUse,
        message: "writer already attached"
      )
    ) {
      try await connection.attach(terminalID: terminalID)
    }
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 2)
  }

  @Test
  func preservesQueuedEventThenFailsOnBufferOverflow() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID)
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      guard
        case .attach(let requestedID, .vtReplayV1, _) = attach.body,
        requestedID == terminalID
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: attachmentID,
            boundarySequence: 10,
            nextInputSequence: 0
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 10,
            data: Data("a".utf8)
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 11,
            data: Data("b".utf8)
          )
        )
      )
      usleep(100_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test,
      eventCapacity: 1
    )
    _ = try await connection.attach(terminalID: terminalID)
    try await Task.sleep(for: .milliseconds(100))

    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 10,
          data: Data("a".utf8)
        )
    )
    await #expect(throws: SupatermHostConnectionError.eventBufferOverflow(1)) {
      try await connection.nextEvent()
    }
    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func validatesContiguousOutputByteOffsets() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID)
    let chunks = [Data([0, 1, 2]), Data([3, 4])]
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: attachmentID,
            boundarySequence: 7,
            nextInputSequence: 0
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 7,
            data: chunks[0]
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 10,
            data: chunks[1]
          )
        )
      )
      usleep(100_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test,
      eventCapacity: 2
    )
    _ = try await connection.attach(terminalID: terminalID)

    for (index, sequence) in [UInt64(7), 10].enumerated() {
      #expect(
        try await connection.nextEvent()
          == .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: sequence,
            data: chunks[index]
          )
      )
    }
    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func rejectsOutputSequenceGap() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID)
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: attachmentID,
            boundarySequence: 4,
            nextInputSequence: 0
          )
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 5,
            data: Data([1])
          )
        )
      )
      usleep(50_000)
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    await #expect(
      throws: SupatermHostConnectionError.outputSequence(
        terminalID: terminalID,
        attachmentID: attachmentID,
        expected: 4,
        actual: 5
      )
    ) {
      try await connection.nextEvent()
    }
    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func canceledRequestResponseDoesNotPoisonNextRequest() async throws {
    let didReadRequest = AsyncStream<Void>.makeStream()
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let canceled = try readClientEnvelope(socket)
      didReadRequest.continuation.yield()
      usleep(50_000)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: canceled.requestID, body: .terminals([]))
      )
      let active = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: active.requestID, body: .terminals([]))
      )
      return [canceled, active]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    let canceled = Task { try await connection.list() }
    for await _ in didReadRequest.stream.prefix(1) {}
    canceled.cancel()
    await #expect(throws: CancellationError.self) {
      try await canceled.value
    }
    #expect(try await connection.list().isEmpty)

    await connection.close()
    let requests = try await server.result.value
    #expect(requests.count == 2)
  }

  @Test
  func canceledEventWaiterCannotConsumeLaterEvent() async throws {
    let releaseEvent = DispatchSemaphore(value: 0)
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      guard releaseEvent.wait(timeout: .now() + 2) == .success else {
        throw SupatermHostWireTestError.timeout
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .exited(terminalID: terminalID, exit: .code(0))
        )
      )
      usleep(50_000)
      return []
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    let canceled = Task { try await connection.nextEvent() }
    await Task.yield()
    canceled.cancel()
    let active = Task { try await connection.nextEvent() }
    await Task.yield()
    releaseEvent.signal()
    await #expect(throws: CancellationError.self) {
      try await canceled.value
    }
    #expect(try await active.value == .exited(terminalID: terminalID, exit: .code(0)))

    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func remoteErrorFailsOneRequestAndKeepsConnectionUsable() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let get = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: get.requestID,
          body: .error(code: .notFound, message: "terminal not found")
        )
      )
      let list = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [get, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.remote(
        code: .notFound,
        message: "terminal not found"
      )
    ) {
      try await connection.get(terminalID: terminalID)
    }
    #expect(try await connection.list().isEmpty)

    await connection.close()
    _ = try await server.result.value
  }
}
