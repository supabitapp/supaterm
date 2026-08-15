import Darwin
import Dispatch
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermHostConnectionTests {
  @Test
  func droppingConnectionCancelsReadAndClosesSocket() async throws {
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 2_000) == 1 else {
        throw SupatermHostWireTestError.timeout
      }
      var byte: UInt8 = 0
      guard Darwin.read(socket, &byte, 1) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      return []
    }
    defer { server.destroy() }

    var connection: SupatermHostConnection? = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    _ = try await connection?.identity()
    connection = nil

    _ = try await server.result.value
  }

  @Test
  func completesHelloAndCorrelatesReversedConcurrentResponses() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let terminal = testTerminalInfo(id: terminalID)
    let machineID = testMachineID("123e4567-e89b-12d3-a456-426614174004")
    let bootID = testBootID("123e4567-e89b-12d3-a456-426614174005")
    let server = try SupatermHostWireTestServer { socket in
      let hello = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: hello.requestID,
          body: .hello(machineID: machineID, bootID: bootID)
        ),
        fragmented: true
      )

      let first = try readClientEnvelope(socket)
      let second = try readClientEnvelope(socket)
      for envelope in [second, first] {
        switch envelope.body {
        case .list:
          try writeHostEnvelope(
            socket,
            SupatermHostEnvelope(requestID: envelope.requestID, body: .terminals([]))
          )
        case .get(let requestedID) where requestedID == terminalID:
          try writeHostEnvelope(
            socket,
            SupatermHostEnvelope(requestID: envelope.requestID, body: .terminal(terminal))
          )
        default:
          throw SupatermHostWireTestError.unexpectedRequest
        }
      }
      return [hello, first, second]
    }
    defer { server.destroy() }

    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )
    let identity = try await connection.identity()
    #expect(identity == SupatermHostIdentity(machineID: machineID, bootID: bootID))

    async let terminals = connection.list()
    async let fetched = connection.get(terminalID: terminalID)
    let result = try await (terminals, fetched)
    #expect(result.0.isEmpty)
    #expect(result.1 == terminal)

    await connection.close()
    let requests = try await server.result.value
    #expect(requests.count == 3)
    guard case .hello = requests[0].body else {
      Issue.record("first request was not hello")
      return
    }
    #expect(requests[0].epoch == supatermHostProtocolEpoch)
    #expect(requests[0].role == .test)
  }

  @Test
  func rejectsCreatedTerminalFromWrongBoot() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let wrongBootID = testBootID("123e4567-e89b-12d3-a456-426614174099")
    let terminal = testTerminalInfo(id: terminalID, bootID: wrongBootID)
    let command = SupatermHostCommand(
      argv: ["/bin/sh"],
      cwd: "/tmp",
      environment: SupatermHostEnvironmentSpec()
    )
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let create = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: create.requestID,
          body: .created(terminal: terminal)
        )
      )
      return [create]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.protocolViolation(
        "active terminal boot ID does not match host"
      )
    ) {
      try await connection.create(terminalID: terminalID, command: command)
    }

    await connection.close()
    #expect(try await server.result.value.count == 1)
  }

  @Test
  func rejectsAttachedTerminalFromWrongBoot() async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = testAttachmentID("123e4567-e89b-12d3-a456-426614174001")
    let wrongBootID = testBootID("123e4567-e89b-12d3-a456-426614174099")
    let terminal = testTerminalInfo(id: terminalID, bootID: wrongBootID)
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
      return [attach]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.protocolViolation(
        "active terminal boot ID does not match host"
      )
    ) {
      try await connection.attach(terminalID: terminalID)
    }

    await connection.close()
    #expect(try await server.result.value.count == 1)
  }

  @Test
  func validatesBootIDForEveryTerminalStatusAndLookup() async throws {
    let currentBootID = testBootID("123e4567-e89b-12d3-a456-426614174005")
    let priorBootID = testBootID("123e4567-e89b-12d3-a456-426614174099")
    let currentBootStatuses: [SupatermHostTerminalStatus] = [
      .starting,
      .running,
      .exiting,
    ]
    let historicalStatuses: [SupatermHostTerminalStatus] = [
      .exited(.code(0)),
      .failed(message: "spawn failed"),
      .interrupted,
    ]

    for lookup in SupatermHostTerminalLookup.allCases {
      for status in currentBootStatuses {
        try await verifyBootIDValidation(
          status: status,
          bootID: currentBootID,
          lookup: lookup,
          accepts: true
        )
        try await verifyBootIDValidation(
          status: status,
          bootID: priorBootID,
          lookup: lookup,
          accepts: false
        )
      }
      for status in historicalStatuses {
        for bootID in [currentBootID, priorBootID] {
          try await verifyBootIDValidation(
            status: status,
            bootID: bootID,
            lookup: lookup,
            accepts: true
          )
        }
      }
    }
  }

  private func verifyBootIDValidation(
    status: SupatermHostTerminalStatus,
    bootID: BootID,
    lookup: SupatermHostTerminalLookup,
    accepts: Bool
  ) async throws {
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let terminal = testTerminalInfo(
      id: terminalID,
      bootID: bootID,
      status: status,
      inputState: .closed
    )
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let request = try readClientEnvelope(socket)
      let message: SupatermHostMessage
      switch (lookup, request.body) {
      case (.list, .list):
        message = .terminals([terminal])
      case (.get, .get(let requestedID)) where requestedID == terminalID:
        message = .terminal(terminal)
      default:
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: request.requestID, body: message)
      )
      return [request]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    if accepts {
      switch lookup {
      case .list:
        #expect(try await connection.list() == [terminal])
      case .get:
        #expect(try await connection.get(terminalID: terminalID) == terminal)
      }
    } else {
      await #expect(
        throws: SupatermHostConnectionError.protocolViolation(
          "active terminal boot ID does not match host"
        )
      ) {
        switch lookup {
        case .list:
          _ = try await connection.list()
        case .get:
          _ = try await connection.get(terminalID: terminalID)
        }
      }
    }

    await connection.close()
    #expect(try await server.result.value.count == 1)
  }

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

private nonisolated enum SupatermHostTerminalLookup: CaseIterable, Sendable {
  case list
  case get
}

private nonisolated struct SupatermHostCanceledAttachFixture: Sendable {
  let activeTerminal: SupatermHostTerminalInfo
  let activeAttachmentID: AttachmentID
  let orphanTerminal: SupatermHostTerminalInfo
  let orphanAttachmentID: AttachmentID
}

private nonisolated func serveCanceledAttachCleanup(
  _ socket: Int32,
  sentFirstReplay: AsyncStream<Void>.Continuation,
  allowFinal: DispatchSemaphore,
  fixture: SupatermHostCanceledAttachFixture
) throws -> [SupatermHostClientEnvelope] {
  try serveHello(socket)
  let activeAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: activeAttach.requestID,
      body: .attached(
        terminal: fixture.activeTerminal,
        attachmentID: fixture.activeAttachmentID,
        boundarySequence: 0,
        nextInputSequence: 0
      )
    )
  )
  let orphanAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attachReplay(
        attachmentID: fixture.orphanAttachmentID,
        segment: .vt,
        data: Data("partial".utf8)
      )
    )
  )
  sentFirstReplay.yield()
  guard allowFinal.wait(timeout: .now() + 2) == .success else {
    throw SupatermHostWireTestError.timeout
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attachReplay(
        attachmentID: fixture.orphanAttachmentID,
        segment: .continuation,
        data: Data("ignored".utf8)
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attached(
        terminal: fixture.orphanTerminal,
        attachmentID: fixture.orphanAttachmentID,
        boundarySequence: 8,
        nextInputSequence: 2
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: fixture.orphanTerminal.id,
        attachmentID: fixture.orphanAttachmentID,
        sequence: 8,
        data: Data([9])
      )
    )
  )
  let cleanup = try readClientEnvelope(socket)
  guard
    case .detach(let terminalID, let attachmentID) = cleanup.body,
    terminalID == fixture.orphanTerminal.id,
    attachmentID == fixture.orphanAttachmentID
  else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: fixture.activeTerminal.id,
        attachmentID: fixture.activeAttachmentID,
        sequence: 0,
        data: Data([7])
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: cleanup.requestID, body: .ack)
  )
  let list = try readClientEnvelope(socket)
  guard case .list = list.body else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
  )
  return [activeAttach, orphanAttach, cleanup, list]
}

private nonisolated func serveResyncIsolation(
  _ socket: Int32,
  revokedTerminal: SupatermHostTerminalInfo,
  revokedAttachmentID: AttachmentID,
  activeTerminal: SupatermHostTerminalInfo,
  activeAttachmentID: AttachmentID
) throws -> [SupatermHostClientEnvelope] {
  try serveHello(socket)
  let revokedAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: revokedAttach.requestID,
      body: .attached(
        terminal: revokedTerminal,
        attachmentID: revokedAttachmentID,
        boundarySequence: 4,
        nextInputSequence: 1
      )
    )
  )
  let activeAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: activeAttach.requestID,
      body: .attached(
        terminal: activeTerminal,
        attachmentID: activeAttachmentID,
        boundarySequence: 20,
        nextInputSequence: 7
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: revokedTerminal.id,
        attachmentID: revokedAttachmentID,
        sequence: 4,
        data: Data("queued".utf8)
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .resyncRequired(
        terminalID: revokedTerminal.id,
        attachmentID: revokedAttachmentID
      )
    )
  )
  let list = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
  )
  let input = try readClientEnvelope(socket)
  guard case .input(_, _, 7, let data) = input.body, data == Data([1]) else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: input.requestID,
      body: .inputCommitted(nextInputSequence: 8)
    )
  )
  return [revokedAttach, activeAttach, list, input]
}

private nonisolated struct SupatermHostWireTestServer: Sendable {
  let root: URL
  let socketURL: URL
  let listener: Int32
  let result: Task<[SupatermHostClientEnvelope], any Error>

  init(
    script: @escaping @Sendable (Int32) throws -> [SupatermHostClientEnvelope]
  ) throws {
    let identifier = UUID().uuidString.prefix(8)
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("sth-wire-\(identifier)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, 0o700) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    let socketURL = root.appendingPathComponent("host.sock")
    let listener = try bindHostWireSocket(at: socketURL)
    self.root = root
    self.socketURL = socketURL
    self.listener = listener
    result = Task.detached {
      let socket = Darwin.accept(listener, nil, nil)
      guard socket >= 0 else {
        throw SupatermHostWireTestError.system(errno)
      }
      defer { Darwin.close(socket) }
      var noSigPipe: Int32 = 1
      guard
        setsockopt(
          socket,
          SOL_SOCKET,
          SO_NOSIGPIPE,
          &noSigPipe,
          socklen_t(MemoryLayout<Int32>.size)
        ) == 0
      else {
        throw SupatermHostWireTestError.system(errno)
      }
      return try script(socket)
    }
  }

  func destroy() {
    result.cancel()
    Darwin.close(listener)
    try? FileManager.default.removeItem(at: root)
  }
}

private nonisolated enum SupatermHostWireTestError: Error {
  case closed
  case pathLength
  case system(Int32)
  case timeout
  case unexpectedRequest
}

private nonisolated func bindHostWireSocket(at socketURL: URL) throws -> Int32 {
  let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard descriptor >= 0 else {
    throw SupatermHostWireTestError.system(errno)
  }
  do {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let path = socketURL.path
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < capacity else {
      throw SupatermHostWireTestError.pathLength
    }
    _ = path.withCString { source in
      withUnsafeMutablePointer(to: &address.sun_path) { destination in
        strncpy(
          UnsafeMutableRawPointer(destination).assumingMemoryBound(to: CChar.self),
          source,
          capacity - 1
        )
      }
    }
    var mutableAddress = address
    let bindResult = withUnsafePointer(to: &mutableAddress) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard bindResult == 0, Darwin.listen(descriptor, 1) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    guard chmod(socketURL.path, 0o600) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    return descriptor
  } catch {
    Darwin.close(descriptor)
    throw error
  }
}

private nonisolated func readClientEnvelope(_ socket: Int32) throws
  -> SupatermHostClientEnvelope
{
  let header = try readHostWireBytes(socket, count: MemoryLayout<UInt32>.size)
  let codec = SupatermHostFrameCodec()
  let length = try codec.decodePayloadLength(header)
  let payload = try readHostWireBytes(socket, count: length)
  return try codec.decodePayload(SupatermHostClientEnvelope.self, from: payload)
}

private nonisolated func writeHostEnvelope(
  _ socket: Int32,
  _ envelope: SupatermHostEnvelope,
  fragmented: Bool = false
) throws {
  let frame = try SupatermHostFrameCodec().encode(envelope)
  if fragmented {
    for byte in frame {
      try writeHostWireBytes(socket, data: Data([byte]))
    }
  } else {
    try writeHostWireBytes(socket, data: frame)
  }
}

private nonisolated func serveHello(_ socket: Int32) throws {
  let hello = try readClientEnvelope(socket)
  guard case .hello = hello.body else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: hello.requestID,
      body: .hello(
        machineID: testMachineID("123e4567-e89b-12d3-a456-426614174004"),
        bootID: testBootID("123e4567-e89b-12d3-a456-426614174005")
      )
    )
  )
}

private nonisolated func readHostWireBytes(_ socket: Int32, count: Int) throws -> Data {
  var data = Data(count: count)
  var offset = 0
  while offset < count {
    let readCount = data.withUnsafeMutableBytes { buffer in
      Darwin.read(socket, buffer.baseAddress?.advanced(by: offset), count - offset)
    }
    if readCount < 0, errno == EINTR {
      continue
    }
    guard readCount > 0 else {
      throw readCount == 0
        ? SupatermHostWireTestError.closed
        : SupatermHostWireTestError.system(errno)
    }
    offset += readCount
  }
  return data
}

private nonisolated func writeHostWireBytes(_ socket: Int32, data: Data) throws {
  try data.withUnsafeBytes { buffer in
    var offset = 0
    while offset < buffer.count {
      let written = Darwin.write(
        socket,
        buffer.baseAddress?.advanced(by: offset),
        buffer.count - offset
      )
      if written < 0, errno == EINTR {
        continue
      }
      guard written > 0 else {
        throw SupatermHostWireTestError.system(errno)
      }
      offset += written
    }
  }
}

private nonisolated func testTerminalInfo(
  id: TerminalID,
  bootID: BootID = testBootID("123e4567-e89b-12d3-a456-426614174005"),
  status: SupatermHostTerminalStatus = .running,
  inputState: SupatermHostInputState = .ready
) -> SupatermHostTerminalInfo {
  SupatermHostTerminalInfo(
    id: id,
    bootID: bootID,
    argv: ["/bin/sh"],
    cwd: "/tmp",
    size: SupatermHostTerminalSize(),
    status: status,
    inputState: inputState
  )
}

private nonisolated func testTerminalID(_ value: String) -> TerminalID {
  TerminalID(rawValue: testUUID(value))
}

private nonisolated func testAttachmentID(_ value: String) -> AttachmentID {
  AttachmentID(rawValue: testUUID(value))
}

private nonisolated func testMachineID(_ value: String) -> MachineID {
  MachineID(rawValue: testUUID(value))
}

private nonisolated func testBootID(_ value: String) -> BootID {
  BootID(rawValue: testUUID(value))
}

private nonisolated func testUUID(_ value: String) -> UUID {
  guard let result = UUID(uuidString: value) else {
    preconditionFailure("invalid test UUID")
  }
  return result
}
