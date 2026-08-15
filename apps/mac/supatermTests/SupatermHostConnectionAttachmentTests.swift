import Darwin
import Dispatch
import Foundation
import Network
import Testing

@testable import SupatermCLIShared

extension SupatermHostConnectionTests {
  @Test
  func streamsOrderedAttachReplayAndStartsOutputAtBoundary() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID)
    let size = SupatermHostTerminalSize(
      rows: 41,
      cols: 103,
      pixelWidth: 721,
      pixelHeight: 533
    )
    let replayFrames = [
      SupatermHostAttachReplayChunk(segment: .vt, data: Data("one".utf8)),
      SupatermHostAttachReplayChunk(segment: .vt, data: Data("two".utf8)),
      SupatermHostAttachReplayChunk(segment: .title, data: Data("build".utf8)),
      SupatermHostAttachReplayChunk(segment: .continuation, data: Data("tail".utf8)),
    ]
    let replay = [
      SupatermHostAttachReplayChunk(segment: .vt, data: Data("onetwo".utf8)),
      SupatermHostAttachReplayChunk(segment: .title, data: Data("build".utf8)),
      SupatermHostAttachReplayChunk(segment: .continuation, data: Data("tail".utf8)),
    ]
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let attach = try readClientEnvelope(socket)
      guard
        case .attach(let requestedID, .vtReplayV1, let requestedSize) = attach.body,
        requestedID == terminalID,
        requestedSize == size
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      for (index, chunk) in replayFrames.enumerated() {
        try writeHostEnvelope(
          socket,
          SupatermHostEnvelope(
            requestID: attach.requestID,
            body: .attachReplay(
              attachmentID: attachmentID,
              segment: chunk.segment,
              data: chunk.data
            )
          ),
          fragmented: index == 0
        )
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: attach.requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: attachmentID,
            boundarySequence: 19,
            nextInputSequence: 7
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
            sequence: 19,
            data: Data("live".utf8)
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

    let attachment = try await connection.attach(terminalID: terminalID, size: size)
    #expect(attachment.terminal == terminal)
    #expect(attachment.attachmentID == attachmentID)
    #expect(attachment.snapshotFormat == .vtReplayV1)
    #expect(attachment.replay == replay)
    #expect(attachment.boundarySequence == 19)
    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 19,
          data: Data("live".utf8)
        )
    )

    await connection.close()
    _ = try await server.result.value
  }

  @Test
  func commitsSequencedInput() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID)
    let chunks = [Data("first".utf8), Data("second".utf8)]
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
            boundarySequence: 0,
            nextInputSequence: 9
          )
        )
      )
      var inputs: [SupatermHostClientEnvelope] = []
      for (index, data) in chunks.enumerated() {
        let input = try readClientEnvelope(socket)
        guard
          case .input(
            let requestedTerminalID,
            let requestedAttachmentID,
            let sequence,
            let requestedData
          ) = input.body,
          requestedTerminalID == terminalID,
          requestedAttachmentID == attachmentID,
          sequence == UInt64(9 + index),
          requestedData == data
        else {
          throw SupatermHostWireTestError.unexpectedRequest
        }
        try writeHostEnvelope(
          socket,
          SupatermHostEnvelope(
            requestID: input.requestID,
            body: .inputCommitted(nextInputSequence: UInt64(10 + index))
          )
        )
        inputs.append(input)
      }
      return [attach] + inputs
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    _ = try await connection.attach(terminalID: terminalID)
    for data in chunks {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: data
      )
    }

    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func rejectsConcurrentInputUntilCommit() async throws {
    let didReadFirstInput = AsyncStream<Void>.makeStream()
    let allowCommit = DispatchSemaphore(value: 0)
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
            boundarySequence: 0,
            nextInputSequence: 3
          )
        )
      )
      let first = try readClientEnvelope(socket)
      guard case .input(_, _, 3, let firstData) = first.body, firstData == Data([1]) else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      didReadFirstInput.continuation.yield()
      guard allowCommit.wait(timeout: .now() + 2) == .success else {
        throw SupatermHostWireTestError.timeout
      }
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 50) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: first.requestID,
          body: .inputCommitted(nextInputSequence: 4)
        )
      )
      let second = try readClientEnvelope(socket)
      guard case .input(_, _, 4, let secondData) = second.body, secondData == Data([3]) else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: second.requestID,
          body: .inputCommitted(nextInputSequence: 5)
        )
      )
      return [attach, first, second]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    let first = Task {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }
    for await _ in didReadFirstInput.stream.prefix(1) {}
    await #expect(
      throws: SupatermHostConnectionError.inputInFlight(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([2])
      )
    }
    allowCommit.signal()
    try await first.value
    try await connection.input(
      terminalID: terminalID,
      attachmentID: attachmentID,
      data: Data([3])
    )

    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func canceledCommittedInputAdvancesOwnedSequence() async throws {
    let didReadInput = AsyncStream<Void>.makeStream()
    let allowCommit = DispatchSemaphore(value: 0)
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
            boundarySequence: 0,
            nextInputSequence: 9
          )
        )
      )
      let canceled = try readClientEnvelope(socket)
      guard
        case .input(_, _, 9, let canceledData) = canceled.body,
        canceledData == Data([1])
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      didReadInput.continuation.yield()
      guard allowCommit.wait(timeout: .now() + 2) == .success else {
        throw SupatermHostWireTestError.timeout
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: canceled.requestID,
          body: .inputCommitted(nextInputSequence: 10)
        )
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .output(
            terminalID: terminalID,
            attachmentID: attachmentID,
            sequence: 0,
            data: Data([7])
          )
        )
      )
      let active = try readClientEnvelope(socket)
      guard case .input(_, _, 10, let activeData) = active.body, activeData == Data([2]) else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: active.requestID,
          body: .inputCommitted(nextInputSequence: 11)
        )
      )
      return [attach, canceled, active]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    let canceled = Task {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }
    for await _ in didReadInput.stream.prefix(1) {}
    canceled.cancel()
    await #expect(throws: CancellationError.self) {
      try await canceled.value
    }
    allowCommit.signal()
    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 0,
          data: Data([7])
        )
    )
    try await connection.input(
      terminalID: terminalID,
      attachmentID: attachmentID,
      data: Data([2])
    )

    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func blocksInputWhenAttachedTerminalIsReadOnly() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = testTerminalInfo(id: terminalID, inputState: .closed)
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
            boundarySequence: 0,
            nextInputSequence: 4
          )
        )
      )
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    await #expect(
      throws: SupatermHostConnectionError.inputUnavailable(
        terminalID: terminalID,
        attachmentID: attachmentID,
        state: .closed
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }

    _ = try await server.result.value
    await connection.close()
  }

  @Test
  func inputUncertainRevokesWritesWithoutStoppingOutput() async throws {
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
            boundarySequence: 7,
            nextInputSequence: 2
          )
        )
      )
      let input = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: input.requestID,
          body: .error(code: .inputUncertain, message: "partial PTY write")
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
            data: Data("still live".utf8)
          )
        )
      )
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      return [attach, input]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    await #expect(
      throws: SupatermHostConnectionError.remote(
        code: .inputUncertain,
        message: "partial PTY write"
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }
    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 7,
          data: Data("still live".utf8)
        )
    )
    await #expect(
      throws: SupatermHostConnectionError.inputUnavailable(
        terminalID: terminalID,
        attachmentID: attachmentID,
        state: .uncertain
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([2])
      )
    }

    _ = try await server.result.value
    await connection.close()
  }

  @Test
  func terminalExitedErrorClosesInputWithoutDroppingOutputCursor() async throws {
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
            boundarySequence: 5,
            nextInputSequence: 2
          )
        )
      )
      let input = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: input.requestID,
          body: .error(code: .terminalExited, message: "terminal exited")
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
            data: Data([7])
          )
        )
      )
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      return [attach, input]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    await #expect(
      throws: SupatermHostConnectionError.remote(
        code: .terminalExited,
        message: "terminal exited"
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }
    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 5,
          data: Data([7])
        )
    )
    await #expect(
      throws: SupatermHostConnectionError.inputUnavailable(
        terminalID: terminalID,
        attachmentID: attachmentID,
        state: .closed
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([2])
      )
    }

    _ = try await server.result.value
    await connection.close()
  }

  @Test
  func notAttachedErrorRevokesCursorAndKeepsConnectionUsable() async throws {
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
            boundarySequence: 0,
            nextInputSequence: 0
          )
        )
      )
      let input = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: input.requestID,
          body: .error(code: .notAttached, message: "attachment expired")
        )
      )
      let list = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [attach, input, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection.attach(terminalID: terminalID)

    await #expect(
      throws: SupatermHostConnectionError.remote(
        code: .notAttached,
        message: "attachment expired"
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([1])
      )
    }
    await #expect(
      throws: SupatermHostConnectionError.protocolViolation(
        "input has no matching attachment"
      )
    ) {
      try await connection.input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        data: Data([2])
      )
    }
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func canceledAttachDetachesOrphanAndKeepsConnectionUsable() async throws {
    let sentFirstReplay = AsyncStream<Void>.makeStream()
    let allowFinal = DispatchSemaphore(value: 0)
    let activeTerminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let orphanTerminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174010")
    let activeAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let orphanAttachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174011")
    let activeTerminal = testTerminalInfo(id: activeTerminalID)
    let orphanTerminal = testTerminalInfo(id: orphanTerminalID)
    let fixture = SupatermHostCanceledAttachFixture(
      activeTerminal: activeTerminal,
      activeAttachmentID: activeAttachmentID,
      orphanTerminal: orphanTerminal,
      orphanAttachmentID: orphanAttachmentID
    )
    let server = try SupatermHostWireTestServer { socket in
      try serveCanceledAttachCleanup(
        socket,
        sentFirstReplay: sentFirstReplay.continuation,
        allowFinal: allowFinal,
        fixture: fixture
      )
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    _ = try await connection.attach(terminalID: activeTerminalID)
    let attach = Task { try await connection.attach(terminalID: orphanTerminalID) }
    for await _ in sentFirstReplay.stream.prefix(1) {}
    attach.cancel()
    await #expect(throws: CancellationError.self) {
      try await attach.value
    }
    allowFinal.signal()
    #expect(
      try await connection.nextEvent()
        == .output(
          terminalID: activeTerminalID,
          attachmentID: activeAttachmentID,
          sequence: 0,
          data: Data([7])
        )
    )
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 4)
  }
}
