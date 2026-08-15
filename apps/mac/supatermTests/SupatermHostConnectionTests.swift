import Darwin
import Dispatch
import Foundation
import Network
import Testing

@testable import SupatermCLIShared

struct SupatermHostConnectionTests {
  @Test
  func transportFailurePreservesNetworkErrorKinds() {
    #expect(
      SupatermHostTransportFailure(NWError.posix(.ECONNREFUSED))
        == .posix(.ECONNREFUSED)
    )
    #expect(SupatermHostTransportFailure(NWError.dns(-65_537)) == .dns(-65_537))
    #expect(SupatermHostTransportFailure(NWError.tls(-9_800)) == .tls(-9_800))
    #expect(
      SupatermHostTransportFailure(NSError(domain: "test.transport", code: 7))
        == .other(domain: "test.transport", code: 7)
    )
  }

  @Test
  func missingOrRefusedIdentifiesOnlyStartupSocketFailures() {
    #expect(SupatermHostTransportFailure.posix(.ENOENT).isMissingOrRefused)
    #expect(SupatermHostTransportFailure.posix(.ECONNREFUSED).isMissingOrRefused)
    #expect(!SupatermHostTransportFailure.posix(.EACCES).isMissingOrRefused)
    #expect(!SupatermHostTransportFailure.dns(-65_537).isMissingOrRefused)
    #expect(!SupatermHostTransportFailure.tls(-9_800).isMissingOrRefused)
    #expect(
      !SupatermHostTransportFailure.other(domain: "test.transport", code: 7)
        .isMissingOrRefused
    )
  }

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
  func reservesThenLaunchesTerminal() async throws {
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let size = SupatermHostTerminalSize(rows: 42, cols: 132)
    let terminal = testTerminalInfo(id: terminalID)
    let command = SupatermHostCommand(
      argv: ["/bin/sh"],
      cwd: "/tmp",
      environment: SupatermHostEnvironmentSpec()
    )
    let startupInput = "printf ready\\n"
    let startupInputDelivery = SupatermHostStartupInputDelivery.prompt
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let reserve = try readClientEnvelope(socket)
      guard
        case .reserve(
          let requestedLaunchTicketID,
          let requestedTerminalID,
          let requestedSize,
          let requestedStartupInput,
          let requestedStartupInputDelivery
        ) = reserve.body,
        requestedLaunchTicketID == launchTicketID,
        requestedTerminalID == terminalID,
        requestedSize == size,
        requestedStartupInput == startupInput,
        requestedStartupInputDelivery == startupInputDelivery
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: reserve.requestID,
          body: .reserved
        )
      )
      let launch = try readClientEnvelope(socket)
      guard
        case .launch(
          let requestedLaunchTicketID,
          let requestedTerminalID,
          let requestedCommand,
          let requestedSize
        ) = launch.body,
        requestedLaunchTicketID == launchTicketID,
        requestedTerminalID == terminalID,
        requestedCommand == command,
        requestedSize == size
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: launch.requestID,
          body: .launched(terminal: terminal)
        )
      )
      return [reserve, launch]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    try await connection.reserve(
      launchTicketID: launchTicketID,
      terminalID: terminalID,
      size: size,
      startupInput: startupInput,
      startupInputDelivery: startupInputDelivery
    )
    #expect(
      try await connection.launch(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        command: command,
        size: size
      ) == terminal
    )

    await connection.close()
    #expect(try await server.result.value.count == 2)
  }

  @Test
  func rejectsLaunchedTerminalFromWrongBoot() async throws {
    let launchTicketID = LaunchTicketID()
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
      let launch = try readClientEnvelope(socket)
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: launch.requestID,
          body: .launched(terminal: terminal)
        )
      )
      return [launch]
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
      try await connection.launch(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        command: command
      )
    }

    await connection.close()
    #expect(try await server.result.value.count == 1)
  }

  @Test
  func reserveAcceptsStartupInputAtUTF8Limit() async throws {
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let startupInput = String(
      repeating: "é",
      count: supatermHostMaximumTerminalDataBytes / 2
    )
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let reserve = try readClientEnvelope(socket)
      guard case .reserve(_, _, _, let requestedStartupInput, .immediate) = reserve.body,
        requestedStartupInput == startupInput
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: reserve.requestID,
          body: .reserved
        )
      )
      return [reserve]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    try await connection.reserve(
      launchTicketID: launchTicketID,
      terminalID: terminalID,
      startupInput: startupInput,
      startupInputDelivery: .immediate
    )

    await connection.close()
    #expect(try await server.result.value.count == 1)
  }

  @Test
  func reserveRejectsStartupInputBeyondUTF8LimitBeforeRequest() async throws {
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let startupInput =
      String(
        repeating: "é",
        count: supatermHostMaximumTerminalDataBytes / 2
      ) + "a"
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      return []
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .test
    )

    await #expect(
      throws: SupatermHostConnectionError.startupInputLength(
        supatermHostMaximumTerminalDataBytes + 1
      )
    ) {
      try await connection.reserve(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        startupInput: startupInput,
        startupInputDelivery: .immediate
      )
    }

    _ = try await server.result.value
    await connection.close()
  }

  @Test
  func cancelReservationSendsTicketScopedRequestAndKeepsConnectionUsable() async throws {
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let cancel = try readClientEnvelope(socket)
      guard
        cancel.body
          == .cancelReservation(
            launchTicketID: launchTicketID,
            terminalID: terminalID
          )
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: cancel.requestID, body: .ack)
      )
      let list = try readClientEnvelope(socket)
      guard case .list = list.body else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [cancel, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .app
    )

    try await connection.cancelReservation(
      launchTicketID: launchTicketID,
      terminalID: terminalID
    )
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 2)
  }

  @Test
  func cancelReservationUsesTheReservedRequestSlot() async throws {
    let didReadReserve = AsyncStream<Void>.makeStream()
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let reserve = try readClientEnvelope(socket)
      guard case .reserve = reserve.body else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      didReadReserve.continuation.yield()
      let cancel = try readClientEnvelope(socket)
      guard
        cancel.body
          == .cancelReservation(
            launchTicketID: launchTicketID,
            terminalID: terminalID
          )
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: cancel.requestID, body: .ack)
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: reserve.requestID, body: .reserved)
      )
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(
          requestID: nil,
          body: .exited(terminalID: terminalID, exit: .code(0))
        )
      )
      let list = try readClientEnvelope(socket)
      guard case .list = list.body else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [reserve, cancel, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .app,
      requestCapacity: 1
    )

    let reservation = Task {
      try await connection.reserve(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in didReadReserve.stream.prefix(1) {}
    reservation.cancel()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    try await connection.cancelReservation(
      launchTicketID: launchTicketID,
      terminalID: terminalID
    )
    #expect(
      try await connection.nextEvent()
        == .exited(terminalID: terminalID, exit: .code(0))
    )
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 3)
  }

  @Test
  func canceledReserveForRunningTicketEmitsNoCleanup() async throws {
    let didReadReserve = AsyncStream<Void>.makeStream()
    let observedNoCleanup = AsyncStream<Void>.makeStream()
    let allowReserved = DispatchSemaphore(value: 0)
    let launchTicketID = LaunchTicketID()
    let terminalID = testTerminalID("123e4567-e89b-12d3-a456-426614174000")
    let server = try SupatermHostWireTestServer { socket in
      try serveHello(socket)
      let reserve = try readClientEnvelope(socket)
      guard
        reserve.body
          == .reserve(
            launchTicketID: launchTicketID,
            terminalID: terminalID,
            size: SupatermHostTerminalSize(),
            startupInput: "",
            startupInputDelivery: .immediate
          )
      else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      didReadReserve.continuation.yield()
      guard allowReserved.wait(timeout: .now() + 2) == .success else {
        throw SupatermHostWireTestError.timeout
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: reserve.requestID, body: .reserved)
      )
      var pollDescriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
      guard Darwin.poll(&pollDescriptor, 1, 200) == 0 else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      observedNoCleanup.continuation.yield()
      let list = try readClientEnvelope(socket)
      guard case .list = list.body else {
        throw SupatermHostWireTestError.unexpectedRequest
      }
      try writeHostEnvelope(
        socket,
        SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
      )
      return [reserve, list]
    }
    defer { server.destroy() }
    let connection = try await SupatermHostConnection.connect(
      socketURL: server.socketURL,
      role: .app
    )

    let reservation = Task {
      try await connection.reserve(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in didReadReserve.stream.prefix(1) {}
    reservation.cancel()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    allowReserved.signal()
    for await _ in observedNoCleanup.stream.prefix(1) {}
    #expect(try await connection.list().isEmpty)

    await connection.close()
    #expect(try await server.result.value.count == 2)
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
}
