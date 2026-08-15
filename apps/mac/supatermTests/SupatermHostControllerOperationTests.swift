import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct SupatermHostControllerOperationTests {
  @Test
  func reservePairsLaunchTicketWithConnectionIdentity() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let size = SupatermHostTerminalSize(
      rows: 42,
      cols: 132,
      pixelWidth: 1_320,
      pixelHeight: 840
    )
    let startupInput = "source /tmp/supaterm-startup.sh\n"
    let startupInputDelivery = SupatermHostStartupInputDelivery.prompt
    var receivedLaunchTicketID: LaunchTicketID?
    var receivedTerminalID: TerminalID?
    var receivedSize: SupatermHostTerminalSize?
    var receivedStartupInput: String?
    var receivedStartupInputDelivery: SupatermHostStartupInputDelivery?
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          reserve: { launchTicketID, terminalID, size, startupInput, startupInputDelivery in
            receivedLaunchTicketID = launchTicketID
            receivedTerminalID = terminalID
            receivedSize = size
            receivedStartupInput = startupInput
            receivedStartupInputDelivery = startupInputDelivery
          }
        )
      }
    )

    let operation = try await controller.reserve(
      terminalID: terminalID,
      size: size,
      startupInput: startupInput,
      startupInputDelivery: startupInputDelivery
    )

    #expect(operation.identity == identity)
    #expect(operation.value == receivedLaunchTicketID)
    #expect(receivedTerminalID == terminalID)
    #expect(receivedSize == size)
    #expect(receivedStartupInput == startupInput)
    #expect(receivedStartupInputDelivery == startupInputDelivery)
  }

  @Test
  func reserveRetriesAnUncertainRequestWithTheSameLaunchTicket() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let size = SupatermHostTerminalSize(rows: 42, cols: 132)
    let startupInput = "printf ready\\n"
    let startupInputDelivery = SupatermHostStartupInputDelivery.immediate
    var connections = 0
    var launchTicketIDs: [LaunchTicketID] = []
    var terminalIDs: [TerminalID] = []
    var sizes: [SupatermHostTerminalSize] = []
    var startupInputs: [String] = []
    var startupInputDeliveries: [SupatermHostStartupInputDelivery] = []
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: identity,
            reserve: {
              launchTicketID,
              terminalID,
              size,
              startupInput,
              startupInputDelivery in
              launchTicketIDs.append(launchTicketID)
              terminalIDs.append(terminalID)
              sizes.append(size)
              startupInputs.append(startupInput)
              startupInputDeliveries.append(startupInputDelivery)
              throw SupatermHostConnectionError.connectionClosed
            },
            close: { closedConnections += 1 }
          )
        }
        return hostConnection(
          identity: identity,
          reserve: {
            launchTicketID,
            requestedTerminalID,
            requestedSize,
            requestedStartupInput,
            requestedStartupInputDelivery in
            launchTicketIDs.append(launchTicketID)
            terminalIDs.append(requestedTerminalID)
            sizes.append(requestedSize)
            startupInputs.append(requestedStartupInput)
            startupInputDeliveries.append(requestedStartupInputDelivery)
          }
        )
      }
    )

    let operation = try await controller.reserve(
      terminalID: terminalID,
      size: size,
      startupInput: startupInput,
      startupInputDelivery: startupInputDelivery
    )

    #expect(operation.identity == identity)
    #expect(launchTicketIDs == [operation.value, operation.value])
    #expect(terminalIDs == [terminalID, terminalID])
    #expect(sizes == [size, size])
    #expect(startupInputs == [startupInput, startupInput])
    #expect(startupInputDeliveries == [startupInputDelivery, startupInputDelivery])
    #expect(connections == 2)
    #expect(closedConnections == 1)
  }

  @Test
  func canceledReserveCancelsItsPrivateTicketOnceWithoutRetry() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<LaunchTicketID>.makeStream()
    let cleanupStarted = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var reserveTickets: [LaunchTicketID] = []
    var cleanupTickets: [LaunchTicketID] = []
    var cleanupTerminalIDs: [TerminalID] = []
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          reserve: {
            launchTicketID,
            _,
            _,
            _,
            _ in
            reserveTickets.append(launchTicketID)
            reserveStarted.continuation.yield(launchTicketID)
            await reserveGate.wait()
            try Task.checkCancellation()
          },
          cancelReservation: { launchTicketID, requestedTerminalID in
            cleanupTickets.append(launchTicketID)
            cleanupTerminalIDs.append(requestedTerminalID)
            cleanupStarted.continuation.yield()
          }
        )
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "printf ready\\n",
        startupInputDelivery: .prompt
      )
    }
    var privateTicket: LaunchTicketID?
    for await ticket in reserveStarted.stream.prefix(1) {
      privateTicket = ticket
    }
    reservation.cancel()
    await reserveGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupStarted.stream.prefix(1) {}

    #expect(reserveTickets.count == 1)
    #expect(reserveTickets.first == privateTicket)
    #expect(cleanupTickets.count == 1)
    #expect(cleanupTickets.first == privateTicket)
    #expect(cleanupTerminalIDs == [terminalID])
  }

  @Test
  func canceledReserveRetriesTicketCleanupOnAFreshConnection() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<LaunchTicketID>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var connections = 0
    var reserveTickets: [LaunchTicketID] = []
    var cleanupTickets: [LaunchTicketID] = []
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: identity,
            reserve: { launchTicketID, _, _, _, _ in
              reserveTickets.append(launchTicketID)
              reserveStarted.continuation.yield(launchTicketID)
              await reserveGate.wait()
              try Task.checkCancellation()
            },
            cancelReservation: { launchTicketID, _ in
              cleanupTickets.append(launchTicketID)
              throw SupatermHostConnectionError.connectionClosed
            },
            close: { closedConnections += 1 }
          )
        }
        return hostConnection(
          identity: identity,
          cancelReservation: { launchTicketID, requestedTerminalID in
            cleanupTickets.append(launchTicketID)
            #expect(requestedTerminalID == terminalID)
            cleanupFinished.continuation.yield()
          }
        )
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    var privateTicket: LaunchTicketID?
    for await ticket in reserveStarted.stream.prefix(1) {
      privateTicket = ticket
    }
    reservation.cancel()
    await reserveGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(reserveTickets.count == 1)
    #expect(reserveTickets.first == privateTicket)
    #expect(cleanupTickets.count == 2)
    #expect(cleanupTickets.allSatisfy { $0 == privateTicket })
    #expect(connections == 2)
    #expect(closedConnections == 1)
  }

  @Test
  func cancellationDuringReserveRetryCancelsTheLogicalTicket() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let retryStarted = AsyncStream<Void>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let retryGate = HostConnectionGate()
    var connections = 0
    var reserveTickets: [LaunchTicketID] = []
    var cleanupTicket: LaunchTicketID?
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: identity,
            reserve: { launchTicketID, _, _, _, _ in
              reserveTickets.append(launchTicketID)
              throw SupatermHostConnectionError.connectionClosed
            }
          )
        }
        return hostConnection(
          identity: identity,
          reserve: { launchTicketID, _, _, _, _ in
            reserveTickets.append(launchTicketID)
            retryStarted.continuation.yield()
            await retryGate.wait()
            try Task.checkCancellation()
          },
          cancelReservation: { launchTicketID, requestedTerminalID in
            cleanupTicket = launchTicketID
            #expect(requestedTerminalID == terminalID)
            cleanupFinished.continuation.yield()
          }
        )
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in retryStarted.stream.prefix(1) {}
    reservation.cancel()
    await retryGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(reserveTickets.count == 2)
    #expect(reserveTickets[0] == reserveTickets[1])
    #expect(cleanupTicket == reserveTickets[0])
    #expect(connections == 2)
  }

  @Test
  func reservationCleanupWaitsForRequestCapacity() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<Void>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var cleanupAttempts = 0
    var cleanupSleeps = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          reserve: { _, _, _, _, _ in
            reserveStarted.continuation.yield()
            await reserveGate.wait()
            try Task.checkCancellation()
          },
          cancelReservation: { _, requestedTerminalID in
            #expect(requestedTerminalID == terminalID)
            cleanupAttempts += 1
            guard cleanupAttempts > 1 else {
              throw SupatermHostConnectionError.requestBufferOverflow(128)
            }
            cleanupFinished.continuation.yield()
          }
        )
      },
      sleep: { _ in cleanupSleeps += 1 }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in reserveStarted.stream.prefix(1) {}
    reservation.cancel()
    await reserveGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(cleanupAttempts == 2)
    #expect(cleanupSleeps == 1)
  }

  @Test
  func failedReserveRetryCancelsThePrivateTicket() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    var connections = 0
    var reserveTickets: [LaunchTicketID] = []
    var cleanupTicket: LaunchTicketID?
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections < 3 {
          return hostConnection(
            identity: identity,
            reserve: { launchTicketID, _, _, _, _ in
              reserveTickets.append(launchTicketID)
              throw SupatermHostConnectionError.connectionClosed
            },
            close: { closedConnections += 1 }
          )
        }
        return hostConnection(
          identity: identity,
          cancelReservation: { launchTicketID, requestedTerminalID in
            cleanupTicket = launchTicketID
            #expect(requestedTerminalID == terminalID)
            cleanupFinished.continuation.yield()
          }
        )
      }
    )

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(reserveTickets.count == 2)
    #expect(reserveTickets[0] == reserveTickets[1])
    #expect(cleanupTicket == reserveTickets[0])
    #expect(connections == 3)
    #expect(closedConnections == 2)
  }

  @Test
  func failedReserveReconnectStillCancelsThePrivateTicket() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    var connections = 0
    var reserveTicket: LaunchTicketID?
    var cleanupTicket: LaunchTicketID?
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        switch connections {
        case 1:
          return hostConnection(
            identity: identity,
            reserve: { launchTicketID, _, _, _, _ in
              reserveTicket = launchTicketID
              throw SupatermHostConnectionError.connectionClosed
            },
            close: { closedConnections += 1 }
          )
        case 2:
          throw SupatermHostConnectionError.connectionClosed
        default:
          return hostConnection(
            identity: identity,
            cancelReservation: { launchTicketID, requestedTerminalID in
              cleanupTicket = launchTicketID
              #expect(requestedTerminalID == terminalID)
              cleanupFinished.continuation.yield()
            }
          )
        }
      }
    )

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(cleanupTicket == reserveTicket)
    #expect(connections == 3)
    #expect(closedConnections == 1)
  }

  @Test
  func cleanupPreservesHostRestartForTheNextLiveOperation() async throws {
    let machineID = MachineID()
    let firstIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let secondIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<Void>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var connections = 0
    var secondConnectionCancelRequests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: firstIdentity,
            reserve: { _, _, _, _, _ in
              reserveStarted.continuation.yield()
              await reserveGate.wait()
              try Task.checkCancellation()
            },
            cancelReservation: { _, _ in
              throw SupatermHostConnectionError.connectionClosed
            }
          )
        }
        return hostConnection(
          identity: secondIdentity,
          cancelReservation: { _, _ in
            secondConnectionCancelRequests += 1
          },
          list: { [] }
        )
      },
      reservationCleanupDidFinish: {
        cleanupFinished.continuation.yield()
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in reserveStarted.stream.prefix(1) {}
    reservation.cancel()
    await reserveGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    await #expect(
      throws: SupatermHostControllerError.hostRestarted(
        previous: firstIdentity.bootID,
        current: secondIdentity.bootID
      )
    ) {
      try await controller.list()
    }
    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: secondIdentity, value: [])
    )
    #expect(secondConnectionCancelRequests == 0)
  }

  @Test
  func reserveRetryKeepsItsOwnBootFenceAfterRestartWasConsumed() async throws {
    let machineID = MachineID()
    let firstIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let secondIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<Void>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var connections = 0
    var firstConnectionListRequests = 0
    var secondConnectionReserveRequests = 0
    var secondConnectionCancelRequests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: firstIdentity,
            reserve: { _, _, _, _, _ in
              reserveStarted.continuation.yield()
              await reserveGate.wait()
              throw SupatermHostConnectionError.connectionClosed
            },
            list: {
              firstConnectionListRequests += 1
              throw SupatermHostConnectionError.connectionClosed
            }
          )
        }
        return hostConnection(
          identity: secondIdentity,
          reserve: { _, _, _, _, _ in
            secondConnectionReserveRequests += 1
          },
          cancelReservation: { _, _ in
            secondConnectionCancelRequests += 1
          },
          list: { [] }
        )
      },
      reservationCleanupDidFinish: {
        cleanupFinished.continuation.yield()
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in reserveStarted.stream.prefix(1) {}
    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.list()
    }
    await #expect(
      throws: SupatermHostControllerError.hostRestarted(
        previous: firstIdentity.bootID,
        current: secondIdentity.bootID
      )
    ) {
      try await controller.list()
    }
    await reserveGate.open()
    await #expect(
      throws: SupatermHostControllerError.hostRestarted(
        previous: firstIdentity.bootID,
        current: secondIdentity.bootID
      )
    ) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: secondIdentity, value: [])
    )
    #expect(firstConnectionListRequests == 1)
    #expect(secondConnectionReserveRequests == 0)
    #expect(secondConnectionCancelRequests == 0)
  }

  @Test(arguments: [SupatermHostErrorCode.conflict, .notFound])
  func cleanupStopsOnFinalReservationResult(
    code: SupatermHostErrorCode
  ) async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminalID = TerminalID()
    let reserveStarted = AsyncStream<Void>.makeStream()
    let cleanupFinished = AsyncStream<Void>.makeStream()
    let reserveGate = HostConnectionGate()
    var connections = 0
    var cleanupRequests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        return hostConnection(
          identity: identity,
          reserve: { _, _, _, _, _ in
            reserveStarted.continuation.yield()
            await reserveGate.wait()
            try Task.checkCancellation()
          },
          cancelReservation: { _, _ in
            cleanupRequests += 1
            throw SupatermHostConnectionError.remote(
              code: code,
              message: "reservation is final"
            )
          },
          list: { [] }
        )
      },
      reservationCleanupDidFinish: {
        cleanupFinished.continuation.yield()
      }
    )

    let reservation = Task {
      try await controller.reserve(
        terminalID: terminalID,
        startupInput: "",
        startupInputDelivery: .immediate
      )
    }
    for await _ in reserveStarted.stream.prefix(1) {}
    reservation.cancel()
    await reserveGate.open()
    await #expect(throws: CancellationError.self) {
      try await reservation.value
    }
    for await _ in cleanupFinished.stream.prefix(1) {}

    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: identity, value: [])
    )
    #expect(connections == 1)
    #expect(cleanupRequests == 1)
  }

  @Test
  func getRejectsTerminalFromAnotherMachineBeforeRequest() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let reference = TerminalReference(machineID: MachineID(), terminalID: TerminalID())
    var requests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          get: { _ in
            requests += 1
            throw SupatermHostControllerTestError.unexpectedRequest
          }
        )
      }
    )

    await #expect(
      throws: SupatermHostControllerError.machineMismatch(
        expected: identity.machineID,
        actual: reference.machineID
      )
    ) {
      try await controller.get(reference)
    }
    #expect(requests == 0)
  }

  @Test
  func getPairsTerminalWithConnectionIdentity() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let reference = TerminalReference(machineID: identity.machineID, terminalID: TerminalID())
    let terminal = hostTerminal(id: reference.terminalID, bootID: identity.bootID)
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          get: { terminalID in
            #expect(terminalID == reference.terminalID)
            return terminal
          }
        )
      }
    )

    #expect(
      try await controller.get(reference)
        == SupatermHostOperation(identity: identity, value: terminal)
    )
  }

  @Test
  func listPairsTerminalRecordsWithCurrentConnectionIdentity() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let current = hostTerminal(id: TerminalID(), bootID: identity.bootID)
    let previous = hostTerminal(
      id: TerminalID(),
      bootID: BootID(),
      status: .exited(.signal("SIGHUP"))
    )
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(identity: identity, list: { [current, previous] })
      }
    )

    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: identity, value: [current, previous])
    )
  }

  @Test
  func endReturnsIdentityForTheEndedTerminal() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let reference = TerminalReference(machineID: identity.machineID, terminalID: TerminalID())
    var endedTerminalID: TerminalID?
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          end: { endedTerminalID = $0 }
        )
      }
    )

    #expect(try await controller.end(reference) == identity)
    #expect(endedTerminalID == reference.terminalID)
  }

  @Test
  func endRejectsTerminalFromAnotherMachineBeforeRequest() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let reference = TerminalReference(machineID: MachineID(), terminalID: TerminalID())
    var requests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        hostConnection(
          identity: identity,
          end: { _ in requests += 1 }
        )
      }
    )

    await #expect(
      throws: SupatermHostControllerError.machineMismatch(
        expected: identity.machineID,
        actual: reference.machineID
      )
    ) {
      try await controller.end(reference)
    }
    #expect(requests == 0)
  }

  @Test
  func closedConnectionIsRecreatedForTheNextOperation() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let terminal = hostTerminal(id: TerminalID(), bootID: identity.bootID)
    var connections = 0
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: identity,
            list: { throw SupatermHostConnectionError.connectionClosed },
            close: { closedConnections += 1 }
          )
        }
        return hostConnection(identity: identity, list: { [terminal] })
      }
    )

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.list()
    }
    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: identity, value: [terminal])
    )
    #expect(connections == 2)
    #expect(closedConnections == 1)
  }

  @Test
  func requestBufferOverflowKeepsTheConnection() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    var connections = 0
    var requests = 0
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        return hostConnection(
          identity: identity,
          list: {
            requests += 1
            guard requests > 1 else {
              throw SupatermHostConnectionError.requestBufferOverflow(1)
            }
            return []
          },
          close: { closedConnections += 1 }
        )
      }
    )

    await #expect(throws: SupatermHostConnectionError.requestBufferOverflow(1)) {
      try await controller.list()
    }
    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: identity, value: [])
    )
    #expect(connections == 1)
    #expect(closedConnections == 0)
  }

}
