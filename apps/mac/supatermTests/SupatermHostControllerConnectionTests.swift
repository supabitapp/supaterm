import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct SupatermHostControllerConnectionTests {
  @Test
  func identityDiscardsAClosedConnection() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    var firstConnectionIsOpen = true
    var connections = 0
    var closedConnections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: identity,
            identityRequest: {
              guard firstConnectionIsOpen else {
                throw SupatermHostConnectionError.connectionClosed
              }
              return identity
            },
            list: { [] },
            close: { closedConnections += 1 }
          )
        }
        return hostConnection(identity: identity)
      }
    )

    _ = try await controller.list()
    firstConnectionIsOpen = false

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.identity()
    }
    #expect(try await controller.identity() == identity)
    #expect(connections == 2)
    #expect(closedConnections == 1)
  }

  @Test
  func reconnectSurfacesHostRestartOnceBeforeUsingNewBoot() async throws {
    let machineID = MachineID()
    let previousIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let currentIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let terminal = hostTerminal(id: TerminalID(), bootID: currentIdentity.bootID)
    var connections = 0
    var currentBootRequests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: previousIdentity,
            list: { throw SupatermHostConnectionError.connectionClosed }
          )
        }
        return hostConnection(
          identity: currentIdentity,
          list: {
            currentBootRequests += 1
            return [terminal]
          }
        )
      }
    )

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.list()
    }
    await #expect(
      throws: SupatermHostControllerError.hostRestarted(
        previous: previousIdentity.bootID,
        current: currentIdentity.bootID
      )
    ) {
      try await controller.list()
    }
    #expect(currentBootRequests == 0)
    #expect(
      try await controller.list()
        == SupatermHostOperation(identity: currentIdentity, value: [terminal])
    )
    #expect(connections == 2)
    #expect(currentBootRequests == 1)
  }

  @Test
  func concurrentReconnectWaitersConsumeHostRestartOnce() async throws {
    let machineID = MachineID()
    let previousIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let currentIdentity = SupatermHostIdentity(machineID: machineID, bootID: BootID())
    let terminal = hostTerminal(id: TerminalID(), bootID: currentIdentity.bootID)
    let reconnectGate = HostConnectionGate()
    let (waiterArrivals, waiterArrivalsContinuation) = AsyncStream.makeStream(of: Void.self)
    var waiterArrivalsIterator = waiterArrivals.makeAsyncIterator()
    var connections = 0
    var currentBootRequests = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: previousIdentity,
            list: { throw SupatermHostConnectionError.connectionClosed }
          )
        }
        await reconnectGate.wait()
        return hostConnection(
          identity: currentIdentity,
          list: {
            currentBootRequests += 1
            return [terminal]
          }
        )
      },
      connectionWaiterDidRegister: { waiterArrivalsContinuation.yield() }
    )

    let disconnected = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await disconnected.value
    }
    let first = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    let second = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    let third = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()

    await reconnectGate.open()

    var restartCount = 0
    var operations: [SupatermHostOperation<[SupatermHostTerminalInfo]>] = []
    for result in [await first.result, await second.result, await third.result] {
      switch result {
      case .success(let operation):
        operations.append(operation)
      case .failure(let error):
        if error as? SupatermHostControllerError
          == .hostRestarted(
            previous: previousIdentity.bootID,
            current: currentIdentity.bootID
          )
        {
          restartCount += 1
        } else {
          Issue.record("unexpected error: \(error)")
        }
      }
    }
    #expect(restartCount == 1)
    #expect(
      operations
        == [
          SupatermHostOperation(identity: currentIdentity, value: [terminal]),
          SupatermHostOperation(identity: currentIdentity, value: [terminal]),
        ]
    )
    #expect(connections == 2)
    #expect(currentBootRequests == 2)
  }

  @Test
  func reconnectRejectsAnotherMachineBeforeRequest() async throws {
    let previousIdentity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let currentIdentity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    var connections = 0
    var currentMachineRequests = 0
    var currentMachineCloses = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        if connections == 1 {
          return hostConnection(
            identity: previousIdentity,
            list: { throw SupatermHostConnectionError.connectionClosed }
          )
        }
        return hostConnection(
          identity: currentIdentity,
          list: {
            currentMachineRequests += 1
            return []
          },
          close: { currentMachineCloses += 1 }
        )
      }
    )

    await #expect(throws: SupatermHostConnectionError.connectionClosed) {
      try await controller.list()
    }
    await #expect(
      throws: SupatermHostControllerError.machineMismatch(
        expected: previousIdentity.machineID,
        actual: currentIdentity.machineID
      )
    ) {
      try await controller.list()
    }
    #expect(currentMachineRequests == 0)
    #expect(currentMachineCloses == 1)
  }

  @Test
  func concurrentOperationsShareOneConnectionAttempt() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let gate = HostConnectionGate()
    let (starts, startsContinuation) = AsyncStream.makeStream(of: Void.self)
    var startsIterator = starts.makeAsyncIterator()
    let (waiterArrivals, waiterArrivalsContinuation) = AsyncStream.makeStream(of: Void.self)
    var waiterArrivalsIterator = waiterArrivals.makeAsyncIterator()
    var connections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        startsContinuation.yield()
        await gate.wait()
        return hostConnection(identity: identity, list: { [] })
      },
      connectionWaiterDidRegister: { waiterArrivalsContinuation.yield() }
    )

    let first = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    _ = await startsIterator.next()
    let second = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()

    #expect(connections == 1)
    await gate.open()
    #expect(try await first.value == SupatermHostOperation(identity: identity, value: []))
    #expect(try await second.value == SupatermHostOperation(identity: identity, value: []))
  }

  @Test
  func canceledConnectionWaiterDoesNotCancelSharedAttempt() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let gate = HostConnectionGate()
    let (starts, startsContinuation) = AsyncStream.makeStream(of: Void.self)
    var startsIterator = starts.makeAsyncIterator()
    let (waiterArrivals, waiterArrivalsContinuation) = AsyncStream.makeStream(of: Void.self)
    var waiterArrivalsIterator = waiterArrivals.makeAsyncIterator()
    var connections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        startsContinuation.yield()
        await gate.wait()
        return hostConnection(identity: identity, list: { [] })
      },
      connectionWaiterDidRegister: { waiterArrivalsContinuation.yield() }
    )
    let first = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    _ = await startsIterator.next()
    let canceled = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()

    canceled.cancel()

    await #expect(throws: CancellationError.self) {
      try await canceled.value
    }
    #expect(connections == 1)
    await gate.open()
    #expect(try await first.value == SupatermHostOperation(identity: identity, value: []))
  }

  @Test
  func canceledConnectionInitiatorDoesNotCancelSharedAttempt() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let gate = HostConnectionGate()
    let (starts, startsContinuation) = AsyncStream.makeStream(of: Void.self)
    var startsIterator = starts.makeAsyncIterator()
    let (waiterArrivals, waiterArrivalsContinuation) = AsyncStream.makeStream(of: Void.self)
    var waiterArrivalsIterator = waiterArrivals.makeAsyncIterator()
    var connections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        connections += 1
        startsContinuation.yield()
        await gate.wait()
        return hostConnection(identity: identity, list: { [] })
      },
      connectionWaiterDidRegister: { waiterArrivalsContinuation.yield() }
    )
    let canceled = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()
    _ = await startsIterator.next()
    let second = Task { try await controller.list() }
    _ = await waiterArrivalsIterator.next()

    canceled.cancel()

    await #expect(throws: CancellationError.self) {
      try await canceled.value
    }
    #expect(connections == 1)
    await gate.open()
    #expect(try await second.value == SupatermHostOperation(identity: identity, value: []))
  }
}
