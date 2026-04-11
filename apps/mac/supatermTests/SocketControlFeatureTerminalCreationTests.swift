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
struct SocketControlCreationTests {
  @Test
  func newTabRequestRepliesWithCreatedTab() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "52A01791-C69B-423B-B58E-021239595B1D")!
    let requestPayload = SupatermNewTabRequest(
      command: "pwd",
      cwd: "/tmp/example",
      focus: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(requestPayload, id: "new-tab-1")
    )
    let expectedResult = SupatermNewTabResult(
      isFocused: false,
      isSelectedSpace: false,
      isSelectedTab: false,
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createTab = { request in
        #expect(
          request
            == .init(
              command: "pwd",
              cwd: "/tmp/example",
              focus: false,
              target: .space(windowIndex: 1, spaceIndex: 2)
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermNewTabResult.self) == expectedResult)
  }
  @Test
  func newTabRequestUsesContextPaneWhenNoExplicitTargetIsProvided() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "505F1E08-BB85-4AD2-BBA2-EC212D88FD4E")!
    let paneID = UUID(uuidString: "FE61D990-4CEE-4AB7-B41E-7C3C7C9EDB6A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        .init(
          command: nil,
          contextPaneID: paneID,
          focus: false
        ),
        id: "new-tab-2"
      )
    )
    let expectedResult = SupatermNewTabResult(
      isFocused: false,
      isSelectedSpace: true,
      isSelectedTab: false,
      windowIndex: 1,
      spaceIndex: 1,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 2,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createTab = { request in
        #expect(
          request
            == .init(
              command: nil,
              cwd: nil,
              focus: false,
              target: .contextPane(paneID)
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermNewTabResult.self) == expectedResult)
  }
  @Test
  func newTabRequestWithoutTargetRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "AB4C87A9-029D-4D50-9160-96717CD76D00")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        .init(
          command: nil,
          focus: false
        ),
        id: "new-tab-3"
      )
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
          response: .error(
            id: "new-tab-3",
            code: "invalid_request",
            message: "Provide a target space or run the command inside a Supaterm pane."
          )
        )
    )
  }
  @Test
  func newTabRequestMapsMissingSpaceToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "D44B2F87-72E6-4972-8E14-4E8DC7E6B3C5")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        .init(
          command: nil,
          focus: true,
          targetWindowIndex: 1,
          targetSpaceIndex: 2
        ),
        id: "new-tab-4"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createTab = { _ in
        throw TerminalCreateTabError.spaceNotFound(windowIndex: 1, spaceIndex: 2)
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
            id: "new-tab-4",
            code: "not_found",
            message: "Space 2 was not found in window 1."
          )
        )
    )
  }
  @Test
  func newPaneRequestRepliesWithCreatedPane() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "0708C52C-64A0-4B3D-B469-3AB200CB4128")!
    let requestPayload = SupatermNewPaneRequest(
      command: "pwd",
      cwd: "/tmp/example",
      direction: .down,
      focus: false,
      equalize: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetPaneIndex: 2
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(requestPayload, id: "new-pane-1")
    )
    let expectedResult = SupatermNewPaneResult(
      direction: .down,
      isFocused: false,
      isSelectedTab: true,
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 1,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 3,
      paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createPane = { request in
        #expect(
          request
            == .init(
              command: "pwd",
              cwd: "/tmp/example",
              direction: .down,
              focus: false,
              equalize: false,
              target: .pane(windowIndex: 1, spaceIndex: 2, tabIndex: 1, paneIndex: 2)
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
          focus: true,
          equalize: true
        ),
        id: "new-pane-2"
      )
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
          response: .error(
            id: "new-pane-2",
            code: "invalid_request",
            message: "Provide a target space and tab or run the command inside a Supaterm pane."
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
          equalize: true,
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
        ),
        id: "new-pane-3"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createPane = { _ in
        throw TerminalCreatePaneError.tabNotFound(windowIndex: 1, spaceIndex: 2, tabIndex: 3)
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
            message: "Tab 3 was not found in space 2 of window 1."
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
          equalize: true,
          targetPaneIndex: 2
        ),
        id: "new-pane-4"
      )
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
          response: .error(
            id: "new-pane-4",
            code: "invalid_request",
            message: "pane target requires a tab target."
          )
        )
    )
  }
  @Test
  func newPaneRequestWithTabWithoutSpaceRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "EAA030B4-15BB-450D-AFC5-C3C3093576D0")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .right,
          focus: true,
          equalize: true,
          targetTabIndex: 2
        ),
        id: "new-pane-5"
      )
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
          response: .error(
            id: "new-pane-5",
            code: "invalid_request",
            message: "tab target requires a space target."
          )
        )
    )
  }
  @Test
  func newPaneRequestWithSpaceWithoutTabRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "D51A0AFB-96F2-4B41-A893-6A1AE06BA123")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .right,
          focus: true,
          equalize: true,
          targetWindowIndex: 1,
          targetSpaceIndex: 2
        ),
        id: "new-pane-6"
      )
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
          response: .error(
            id: "new-pane-6",
            code: "invalid_request",
            message: "space target requires a tab target."
          )
        )
    )
  }
  @Test
  func newPaneRequestMapsMissingSpaceToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "6BD0C483-E2AC-464A-81DF-D29134C9232D")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        .init(
          command: nil,
          direction: .right,
          focus: true,
          equalize: true,
          targetWindowIndex: 1,
          targetSpaceIndex: 4,
          targetTabIndex: 1
        ),
        id: "new-pane-7"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createPane = { _ in
        throw TerminalCreatePaneError.spaceNotFound(windowIndex: 1, spaceIndex: 4)
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
            id: "new-pane-7",
            code: "not_found",
            message: "Space 4 was not found in window 1."
          )
        )
    )
  }
}
