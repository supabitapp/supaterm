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
          response: .ok(id: "ping-1", result: ["pong": true])
        )
    )
  }

  @Test
  func treeRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "92B503AB-CC76-4D91-A024-FD4D400F0446")!
    let tab = SupatermTreeSnapshot.Tab(
      index: 1,
      title: "zsh",
      isSelected: true,
      panes: [.init(index: 1, isFocused: true)]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      tabs: [tab]
    )
    let snapshot = SupatermTreeSnapshot(
      windows: [window]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .tree(id: "tree-1")
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalClient.treeSnapshot = { snapshot }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }

  @Test
  func newPaneRequestRepliesWithCreatedPane() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "0708C52C-64A0-4B3D-B469-3AB200CB4128")!
    let requestPayload = SupatermNewPaneRequest(
      command: "pwd",
      direction: .down,
      focus: false,
      targetPaneIndex: 2,
      targetTabIndex: 1,
      targetWindowIndex: 1
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(requestPayload, id: "new-pane-1")
    )
    let expectedResult = SupatermNewPaneResult(
      direction: .down,
      focused: false,
      paneIndex: 3,
      tabIndex: 1,
      windowIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalClient.createPane = { request in
        #expect(
          request
            == .init(
              command: "pwd",
              direction: .down,
              focus: false,
              target: .pane(windowIndex: 1, tabIndex: 1, paneIndex: 2)
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermNewPaneResult.self) == expectedResult)
  }

  @Test
  func newPaneRequestWithoutTargetRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "EA06B587-72E5-4B21-8D1F-B4FD97E0C497")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .right,
          focus: true
        ),
        id: "new-pane-2"
      )
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
            id: "new-pane-2",
            code: "invalid_request",
            message: "Provide a target tab or run the command inside a Supaterm pane."
          )
        )
    )
  }

  @Test
  func newPaneRequestMapsMissingTabToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "43F86918-86FD-4401-B0B8-444497BA544A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .right,
          focus: true,
          targetTabIndex: 3,
          targetWindowIndex: 1
        ),
        id: "new-pane-3"
      )
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalClient.createPane = { _ in
        throw TerminalCreatePaneError.tabNotFound(windowIndex: 1, tabIndex: 3)
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
            id: "new-pane-3",
            code: "not_found",
            message: "Tab 3 was not found in window 1."
          )
        )
    )
  }

  @Test
  func newPaneRequestWithPaneWithoutTabRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "2C6A60E8-9B42-40F7-91A4-DBE3337171CD")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .left,
          focus: true,
          targetPaneIndex: 2
        ),
        id: "new-pane-4"
      )
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
            id: "new-pane-4",
            code: "invalid_request",
            message: "pane target requires a tab target."
          )
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
