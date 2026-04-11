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
    startedAt: .init(timeIntervalSince1970: 0)
  )

  let store = makeStore {
    $0.socketControlClient.requests = { stream }
    $0.socketControlClient.start = { endpoint }
  }

  await store.send(.task)
  await store.receive(\.started) {
    $0.endpoint = endpoint
    $0.startErrorMessage = nil
  }

  continuation.finish()
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
      == .init(
        handle: handle,
        response: .ok(id: "ping-1", result: ["pong": true])
      )
  )
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
    startedAt: .init(timeIntervalSince1970: 1)
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

  let store = makeStore {
    $0.socketControlClient.stop = {
      await recorder.recordStop()
    }
  }

  await store.send(.shutdown)

  #expect(await recorder.stopCount() == 1)
}
}
