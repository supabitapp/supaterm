import ComposableArchitecture
import Foundation
import Sharing
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureLifecycleTests {
  @Test
  func taskStartsSocketObservationAndStoresEndpoint() async {
    let (stream, continuation) = AsyncStream.makeStream(of: SocketControlClient.Request.self)
    let endpoint = SupatermSocketEndpoint(
      id: UUID(uuidString: "8D630A04-61B5-48E8-9D7E-F7E0BB8B9B16")!,
      name: "test",
      path: "/tmp/supaterm.sock",
      pid: 1,
      startedAt: Date(timeIntervalSince1970: 0)
    )

    let store = makeStore {
      $0.socketControlClient.requests = { stream }
      $0.socketControlClient.start = { endpoint }
    }

    await store.send(.task) {
      $0.status = .starting
    }
    await store.receive(\.startResponse) {
      $0.status = .running(endpoint)
    }

    continuation.finish()
    await store.finish()
  }

  @Test
  func taskFailureStoresOneCoherentStatus() async {
    let store = makeStore {
      $0.socketControlClient.start = {
        throw NSError(
          domain: "SocketControlFeatureLifecycleTests",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Cannot bind socket"]
        )
      }
    }

    await store.send(.task) {
      $0.status = .starting
    }
    await store.receive(\.startResponse) {
      $0.status = .failed("Cannot bind socket")
    }
  }

  @Test
  func shutdownDuringStartupStaysStopped() async {
    let startup = LockIsolated((started: false, cancelled: false))
    let store = makeStore {
      $0.socketControlClient.start = {
        startup.withValue { $0.started = true }
        do {
          try await Task.sleep(for: .seconds(60))
        } catch {
          startup.withValue { $0.cancelled = true }
          throw error
        }
        throw CancellationError()
      }
      $0.socketControlClient.stop = {}
    }

    await store.send(.task) {
      $0.status = .starting
    }
    #expect(await waitUntil { startup.value.started })

    await store.send(.shutdown) {
      $0.status = .stopped
    }

    #expect(await waitUntil { startup.value.cancelled })
    await store.finish()
  }

  @Test
  func shutdownCancelsActiveObservation() async {
    let endpoint = SupatermSocketEndpoint(
      id: UUID(uuidString: "51BBF8B3-747D-443C-8070-D3B32299A323")!,
      name: "test",
      path: "/tmp/supaterm.sock",
      pid: 1,
      startedAt: Date(timeIntervalSince1970: 0)
    )
    let terminationCount = LockIsolated(0)
    let stream = AsyncStream<SocketControlClient.Request> { continuation in
      continuation.onTermination = { _ in
        terminationCount.withValue { $0 += 1 }
      }
    }
    let store = makeStore {
      $0.socketControlClient.requests = { stream }
      $0.socketControlClient.start = { endpoint }
      $0.socketControlClient.stop = {}
    }

    await store.send(.task) {
      $0.status = .starting
    }
    await store.receive(\.startResponse) {
      $0.status = .running(endpoint)
    }
    await store.send(.shutdown) {
      $0.status = .stopped
    }

    #expect(await waitUntil { terminationCount.value == 1 })
    await store.finish()
  }

  @Test
  func shutdownCancelsInFlightRequest() async throws {
    let execution = LockIsolated((started: false, cancelled: false))
    let request = SocketControlClient.Request(
      handle: UUID(uuidString: "76863D5A-9FD6-4E6F-829E-42797DD88F82")!,
      payload: try .newTab(
        SupatermNewTabRequest(
          startupCommand: .exec(["pwd"], searchPath: "/usr/bin:/bin"),
          focus: false,
          target: .space(UUID())
        ),
        id: "cancelled-new-tab"
      )
    )
    let store = makeStore {
      $0.socketControlClient.stop = {}
      $0.terminalWindowsClient.createTab = { _ in
        execution.withValue { $0.started = true }
        do {
          try await Task.sleep(for: .seconds(60))
        } catch {
          execution.withValue { $0.cancelled = true }
          throw error
        }
        throw CancellationError()
      }
    }

    await store.send(.requestReceived(request))
    #expect(await waitUntil { execution.value.started })

    await store.send(.shutdown)

    #expect(await waitUntil { execution.value.cancelled })
    await store.finish()
  }

  @Test
  func pingRequestRepliesWithPong() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "4C6584B8-0282-4E52-B294-76FA9E934E83")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .ping(id: "ping-1")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(
      records.first
        == SocketReplyRecorder.Record(
          handle: handle,
          response: .ok(id: "ping-1", result: ["pong": true])
        )
    )
  }

  @Test
  func expiredRequestDoesNotExecuteSideEffects() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "A0BB14C3-962E-40E2-B105-503CF7B87B45")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        SupatermNewTabRequest(
          startupCommand: .exec(["pwd"], searchPath: "/usr/bin:/bin"),
          focus: false,
          target: .space(UUID())
        ),
        id: "expired-new-tab-1"
      )
    )

    let store = makeStore {
      $0.socketControlClient.isPending = { _ in false }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createTab = { _ in
        Issue.record("Expired request should not create a tab.")
        throw POSIXError(.EIO)
      }
    }

    await store.send(.requestReceived(request))

    #expect(await recorder.snapshot().isEmpty)
  }

  @Test
  func identityRequestRepliesWithEndpoint() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "47185392-AB73-4468-892D-B3B9D1D298D2")!
    let endpoint = SupatermSocketEndpoint(
      id: UUID(uuidString: "DD52F0A9-E77A-4B52-982C-2778426AF7FB")!,
      name: "dev",
      path: "/tmp/dev.sock",
      pid: 42,
      startedAt: Date(timeIntervalSince1970: 1)
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .identity(id: "identity-1")
    )

    let store = makeStore {
      $0.socketControlClient.currentEndpoint = { endpoint }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermSocketEndpoint.self) == endpoint)
  }
  @Test
  func shutdownStopsSocketRuntime() async {
    let recorder = StopRecorder()
    let endpoint = SupatermSocketEndpoint(
      id: UUID(uuidString: "C8B0AB8F-B55B-447E-B37B-C1BB2DA42493")!,
      name: "test",
      path: "/tmp/supaterm.sock",
      pid: 1,
      startedAt: Date(timeIntervalSince1970: 0)
    )

    let store = makeStore(initialState: SocketControlFeature.State(status: .running(endpoint))) {
      $0.socketControlClient.stop = {
        await recorder.recordStop()
      }
    }

    await store.send(.shutdown) {
      $0.status = .stopped
    }

    #expect(await recorder.stopCount() == 1)
  }
}
