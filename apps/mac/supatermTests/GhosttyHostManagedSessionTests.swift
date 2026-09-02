import Foundation
import GhosttyKit
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct GhosttyHostManagedSessionTests {
  @Test
  func callbacksCopyInputAndViewportBeforeReturning() async throws {
    let session = GhosttyHostManagedSession()
    var config = ghostty_surface_config_new()
    session.configure(&config)
    var iterator = session.events.makeAsyncIterator()
    var input = Array("hello".utf8)

    let accepted = input.withUnsafeBufferPointer { buffer in
      config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
    }
    input[0] = 0
    config.host_resize?(config.host_userdata, 91, 37, 1_400, 900)

    #expect(try #require(await iterator.next()) == .input(Data("hello".utf8)))
    #expect(
      try #require(await iterator.next())
        == .viewport(
          columns: 91,
          rows: 37,
          widthPixels: 1_400,
          heightPixels: 900
        ))
    #expect(config.host_managed)
    #expect(config.host_input_capacity == 16 * 1_024 * 1_024)
    #expect(accepted == true)
  }

  @Test
  func outputAndSnapshotCallsStopAfterDetach() async throws {
    let calls = Mutex<[Call]>([])
    let session = GhosttyHostManagedSession(
      write: { address, data in
        calls.withLock { $0.append(.write(address, data)) }
        return true
      },
      prepareSnapshot: { address, data in
        calls.withLock { $0.append(.prepareSnapshot(address, data)) }
        return 0x5678
      },
      commitSnapshot: { address, snapshotAddress in
        calls.withLock { $0.append(.commitSnapshot(address, snapshotAddress)) }
        return true
      },
      freeSnapshot: { snapshotAddress in
        calls.withLock { $0.append(.freeSnapshot(snapshotAddress)) }
      }
    )
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    var config = ghostty_surface_config_new()
    session.configure(&config)

    #expect(session.attach(surface))
    let wrote = await session.write(Data("later".utf8))
    let restored = await session.restore(Data("snapshot".utf8))
    session.detach()
    let wroteAfterDetach = await session.write(Data("ignored".utf8))
    let restoredAfterDetach = await session.restore(Data("ignored".utf8))

    #expect(wrote)
    #expect(restored)
    #expect(!wroteAfterDetach)
    #expect(!restoredAfterDetach)

    #expect(
      calls.withLock { $0 }
        == [
          .write(0x1234, Data("later".utf8)),
          .prepareSnapshot(0x1234, Data("snapshot".utf8)),
          .commitSnapshot(0x1234, 0x5678),
        ])
  }

  @Test
  func surfaceCallsUseTheirRequiredExecutors() async throws {
    let callThreads = Mutex<[Bool]>([])
    let session = GhosttyHostManagedSession(
      write: { _, _ in
        callThreads.withLock { $0.append(Thread.isMainThread) }
        return true
      },
      prepareSnapshot: { _, _ in
        callThreads.withLock { $0.append(Thread.isMainThread) }
        return 0x5678
      },
      commitSnapshot: { _, _ in
        callThreads.withLock { $0.append(Thread.isMainThread) }
        return true
      }
    )
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    var config = ghostty_surface_config_new()
    session.configure(&config)
    #expect(session.attach(surface))

    let wrote = await session.write(Data("output".utf8))
    let restored = await session.restore(Data("snapshot".utf8))

    #expect(wrote)
    #expect(restored)
    #expect(callThreads.withLock { $0 } == [false, false, true])
  }

  @Test
  func failedSnapshotCommitFreesPreparedStateOffMainActor() async throws {
    let calls = Mutex<[Call]>([])
    let freeRanOnMain = Mutex<Bool?>(nil)
    let session = GhosttyHostManagedSession(
      prepareSnapshot: { _, _ in 0x5678 },
      commitSnapshot: { address, snapshotAddress in
        calls.withLock { $0.append(.commitSnapshot(address, snapshotAddress)) }
        return false
      },
      freeSnapshot: { snapshotAddress in
        calls.withLock { $0.append(.freeSnapshot(snapshotAddress)) }
        freeRanOnMain.withLock { $0 = Thread.isMainThread }
      }
    )
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    var config = ghostty_surface_config_new()
    session.configure(&config)
    #expect(session.attach(surface))

    let restored = await session.restore(Data("snapshot".utf8))

    #expect(!restored)
    #expect(
      calls.withLock { $0 }
        == [
          .commitSnapshot(0x1234, 0x5678),
          .freeSnapshot(0x5678),
        ])
    #expect(freeRanOnMain.withLock { $0 } == false)
  }

  @Test
  func snapshotCommitCannotBeOvertakenByOutput() async throws {
    let gate = Gate()
    let commitStarted = Mutex(false)
    let steps = Mutex<[QueueStep]>([])
    let session = GhosttyHostManagedSession(
      write: { _, _ in
        steps.withLock { $0.append(.write) }
        return true
      },
      prepareSnapshot: { _, _ in
        steps.withLock { $0.append(.prepare) }
        return 0x5678
      },
      commitSnapshot: { _, _ in
        steps.withLock { $0.append(.commitStarted) }
        commitStarted.withLock { $0 = true }
        await gate.wait()
        steps.withLock { $0.append(.commitFinished) }
        return true
      }
    )
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    var config = ghostty_surface_config_new()
    session.configure(&config)
    #expect(session.attach(surface))

    let restoreTask = Task { await session.restore(Data("snapshot".utf8)) }
    #expect(await waitUntil { commitStarted.withLock { $0 } })
    let writeTask = Task { await session.write(Data("output".utf8)) }
    for _ in 0..<10 {
      await Task.yield()
    }
    #expect(steps.withLock { $0 } == [.prepare, .commitStarted])

    await gate.release()

    #expect(await restoreTask.value)
    #expect(await writeTask.value)
    #expect(steps.withLock { $0 } == [.prepare, .commitStarted, .commitFinished, .write])
  }

  @Test
  func sustainedWritesDrainAfterSynchronousMainActorDetach() async throws {
    let payloads = (1...4).map { Data("output-\($0)".utf8) }
    let writes = Mutex<[Data]>([])
    let writeThreads = Mutex<[Bool]>([])
    let mainCallbackThreads = Mutex<[Bool]>([])
    let queuedTasks = Mutex<[Task<Bool, Never>]>([])
    let detachResults = Mutex<[Bool]>([])
    let drainCount = Mutex(0)
    let writeCountAtDrain = Mutex<Int?>(nil)
    let sessionBox = Mutex<GhosttyHostManagedSession?>(nil)
    let session = GhosttyHostManagedSession(
      surfaceCallCapacity: payloads.count,
      write: { _, data in
        writeThreads.withLock { $0.append(Thread.isMainThread) }
        writes.withLock { $0.append(data) }
        guard data == payloads[0], let session = sessionBox.withLock({ $0 }) else {
          return true
        }
        let tasks = payloads.dropFirst().map { payload in
          Task.immediate {
            await session.write(payload)
          }
        }
        queuedTasks.withLock { $0 = tasks }
        let detach: @MainActor @Sendable () -> Void = {
          mainCallbackThreads.withLock { $0.append(Thread.isMainThread) }
          let first = session.detach {
            let writeCount = writes.withLock { $0.count }
            writeCountAtDrain.withLock { $0 = writeCount }
            drainCount.withLock { $0 += 1 }
          }
          let second = session.detach {
            drainCount.withLock { $0 += 1 }
          }
          detachResults.withLock { $0 = [first, second] }
        }
        if Thread.isMainThread {
          MainActor.assumeIsolated { detach() }
        } else {
          DispatchQueue.main.sync {
            MainActor.assumeIsolated { detach() }
          }
        }
        return true
      }
    )
    sessionBox.withLock { $0 = session }
    defer { sessionBox.withLock { $0 = nil } }
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    var config = ghostty_surface_config_new()
    session.configure(&config)
    #expect(session.attach(surface))

    let firstResult = await session.write(payloads[0])
    let tasks = queuedTasks.withLock { $0 }
    var queuedResults: [Bool] = []
    for task in tasks {
      queuedResults.append(await task.value)
    }
    let rejected = await session.write(Data("rejected".utf8))

    #expect(firstResult)
    #expect(queuedResults == [true, true, true])
    #expect(!rejected)
    #expect(writes.withLock { $0 } == payloads)
    #expect(writeThreads.withLock { $0 } == [false, false, false, false])
    #expect(mainCallbackThreads.withLock { $0 } == [true])
    #expect(detachResults.withLock { $0 } == [true, false])
    #expect(drainCount.withLock { $0 } == 1)
    #expect(writeCountAtDrain.withLock { $0 } == payloads.count)
  }

  @Test
  func callbackBufferRejectsAnOversizedInputAtomically() async {
    let session = GhosttyHostManagedSession(
      eventBufferCapacity: 2,
      eventBufferByteCapacity: 2
    )
    var config = ghostty_surface_config_new()
    session.configure(&config)
    let input = Array("abcdef".utf8)

    let accepted = input.withUnsafeBufferPointer { buffer in
      config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
    }

    var iterator = session.events.makeAsyncIterator()
    #expect(accepted == false)
    #expect(config.host_input_capacity == 2)
    await #expect(throws: GhosttyHostManagedSessionError.eventBufferOverflow) {
      try await iterator.next()
    }
  }

  @Test
  func staticInputCapacityRejectionFailsTheEventStream() async {
    let session = GhosttyHostManagedSession(eventBufferByteCapacity: 2)
    var config = ghostty_surface_config_new()
    session.configure(&config)

    config.host_input_rejected?(config.host_userdata, 3)

    var iterator = session.events.makeAsyncIterator()
    await #expect(throws: GhosttyHostManagedSessionError.eventBufferOverflow) {
      try await iterator.next()
    }
  }

  @Test
  func callbackBufferFailsAfterItsWholeEventCapacity() async throws {
    let session = GhosttyHostManagedSession(
      eventBufferCapacity: 2,
      eventBufferByteCapacity: 4
    )
    var config = ghostty_surface_config_new()
    session.configure(&config)

    let results = [Array("ab".utf8), Array("cd".utf8), Array("ef".utf8)].map { input in
      input.withUnsafeBufferPointer { buffer in
        config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
      }
    }

    var iterator = session.events.makeAsyncIterator()
    #expect(try #require(await iterator.next()) == .input(Data("ab".utf8)))
    #expect(try #require(await iterator.next()) == .input(Data("cd".utf8)))
    #expect(results == [true, true, false])
    await #expect(throws: GhosttyHostManagedSessionError.eventBufferOverflow) {
      try await iterator.next()
    }
  }

  @Test
  func callbackCapacityReturnsAfterAnEventIsDequeued() async throws {
    let session = GhosttyHostManagedSession(
      eventBufferCapacity: 1,
      eventBufferByteCapacity: 2
    )
    var config = ghostty_surface_config_new()
    session.configure(&config)
    var iterator = session.events.makeAsyncIterator()
    let first = Array("ab".utf8)
    let second = Array("cd".utf8)

    let acceptedFirst = first.withUnsafeBufferPointer { buffer in
      config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
    }
    #expect(acceptedFirst == true)
    #expect(try #require(await iterator.next()) == .input(Data(first)))
    let acceptedSecond = second.withUnsafeBufferPointer { buffer in
      config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
    }
    #expect(acceptedSecond == true)
    #expect(try #require(await iterator.next()) == .input(Data(second)))
  }

  @Test
  func canceledConsumerRejectsLaterInputBeforeCopying() async {
    let session = GhosttyHostManagedSession()
    var config = ghostty_surface_config_new()
    session.configure(&config)
    let started = Mutex(false)
    let consumer = Task {
      var iterator = session.events.makeAsyncIterator()
      started.withLock { $0 = true }
      return try await iterator.next()
    }
    #expect(await waitUntil { started.withLock { $0 } })

    consumer.cancel()
    _ = try? await consumer.value
    let input = Array("ignored".utf8)
    let accepted = input.withUnsafeBufferPointer { buffer in
      config.host_input?(config.host_userdata, buffer.baseAddress, buffer.count)
    }

    #expect(accepted == false)
  }

  @Test
  func detachBeforeAttachFinishesEvents() async throws {
    let session = GhosttyHostManagedSession()
    session.detach()
    var iterator = session.events.makeAsyncIterator()

    #expect(try await iterator.next() == nil)
  }

  @Test
  func detachDuringSurfaceCreationRejectsAndFreesTheSurface() async throws {
    initializeGhosttyForTests()
    let session = GhosttyHostManagedSession()
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session,
      surfaceFactory: { app, config in
        let surface = ghostty_surface_new(app, config)
        session.detach()
        return surface
      }
    )
    var iterator = session.events.makeAsyncIterator()

    #expect(surfaceView.surface == nil)
    #expect(surfaceView.bridge.surface == nil)
    #expect(try await iterator.next() == nil)
  }

  @Test
  func surfaceCallQueueRejectsWorkBeyondItsBounds() async throws {
    let callStarted = Mutex(false)
    let allowCallToReturn = DispatchSemaphore(value: 0)
    let session = GhosttyHostManagedSession(
      surfaceCallCapacity: 1,
      surfaceCallByteCapacity: 4,
      write: { _, _ in
        callStarted.withLock { $0 = true }
        allowCallToReturn.wait()
        return true
      }
    )
    var config = ghostty_surface_config_new()
    session.configure(&config)
    let surface = try #require(UnsafeMutableRawPointer(bitPattern: 0x1234))
    #expect(session.attach(surface))
    let firstCall = Task {
      await session.write(Data("full".utf8))
    }

    #expect(await waitUntil { callStarted.withLock { $0 } })
    let secondCall = await session.write(Data("x".utf8))
    #expect(!secondCall)
    allowCallToReturn.signal()
    #expect(await firstCall.value)
  }

  @Test
  func failedSurfaceCreationFinishesEvents() async throws {
    initializeGhosttyForTests()
    let session = GhosttyHostManagedSession()
    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session,
      surfaceFactory: { _, _ in nil }
    )
    var iterator = session.events.makeAsyncIterator()

    #expect(surfaceView.bridge.state.failure == .surfaceCreationFailed)
    #expect(try await iterator.next() == nil)
  }

  @Test
  func closeRetainsTheViewUntilAnAdmittedCallDrains() async {
    initializeGhosttyForTests()
    let callStarted = Mutex(false)
    let allowCallToReturn = DispatchSemaphore(value: 0)
    let session = GhosttyHostManagedSession(
      write: { _, _ in
        callStarted.withLock { $0 = true }
        allowCallToReturn.wait()
        return true
      }
    )
    var surfaceView: GhosttySurfaceView? = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session
    )
    weak let retainedView = surfaceView
    let writeTask = Task {
      await session.write(Data("output".utf8))
    }

    #expect(await waitUntil { callStarted.withLock { $0 } })
    surfaceView?.closeSurface()
    #expect(surfaceView?.surface == nil)
    surfaceView = nil
    #expect(retainedView != nil)

    allowCallToReturn.signal()
    #expect(await writeTask.value)
    #expect(await waitUntil { retainedView == nil })
  }

  @Test
  func hostDeinitClosesAnOwnedHostManagedSurface() {
    initializeGhosttyForTests()
    let runtime = GhosttyRuntime()
    let session = GhosttyHostManagedSession()
    var host: TerminalHostState? = .test(
      runtime: runtime,
      zmxClient: .noop,
      zmxSessionsEnabled: false
    )
    let surface = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session
    )
    defer { surface.closeSurface() }
    host?.surfaces[surface.id] = surface
    #expect(surface.surface != nil)

    host = nil

    #expect(surface.surface == nil)
    #expect(surface.bridge.surface == nil)
  }

  private enum Call: Equatable, Sendable {
    case write(UInt, Data)
    case prepareSnapshot(UInt, Data)
    case commitSnapshot(UInt, UInt)
    case freeSnapshot(UInt)
  }

  private enum QueueStep: Equatable, Sendable {
    case prepare
    case commitStarted
    case commitFinished
    case write
  }

  private actor Gate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false

    func wait() async {
      if released { return }
      await withCheckedContinuation { continuation = $0 }
    }

    func release() {
      released = true
      continuation?.resume()
      continuation = nil
    }
  }

}
