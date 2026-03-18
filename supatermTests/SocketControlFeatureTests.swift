import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureTests {
  @Test
  func taskStartsSocketObservationAndStoresSocketPath() async {
    let (stream, continuation) = AsyncStream.makeStream(of: SocketControlClient.Request.self)

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.requests = { stream }
      $0.socketControlClient.start = { "/tmp/supaterm.sock" }
    }

    await store.send(.task)
    await store.receive(\.started) {
      $0.socketPath = "/tmp/supaterm.sock"
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

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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
          response: .ok(id: "ping-1", result: ["pong": .bool(true)])
        )
    )
  }

  @Test
  func unknownMethodRepliesWithStructuredError() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "B12602E1-5D37-470E-9388-55CD09D400CA")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .init(id: "request-2", method: "workspace.list")
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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
          response: .error(
            id: "request-2",
            code: "method_not_found",
            message: "Unknown method 'workspace.list'."
          )
        )
    )
  }
}

private actor SocketReplyRecorder {
  struct Record: Equatable {
    let handle: UUID
    let response: SupatermSocketResponse
  }

  private var records: [Record] = []

  func record(
    handle: UUID,
    response: SupatermSocketResponse
  ) {
    records.append(.init(handle: handle, response: response))
  }

  func snapshot() -> [Record] {
    records
  }
}
