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
    let groupID = UUID(uuidString: "BEA0180D-C5AF-4A85-96DD-5B6356C87CD8")!
    let requestPayload = SupatermNewTabRequest(
      startupCommand: "pwd",
      cwd: "/tmp/example",
      focus: false,
      target: .group(groupID)
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
            == TerminalCreateTabRequest(
              startupCommand: "pwd",
              cwd: "/tmp/example",
              focus: false,
              target: .group(groupID)
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
  func newTabRequestMapsPaneTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "505F1E08-BB85-4AD2-BBA2-EC212D88FD4E")!
    let paneID = UUID(uuidString: "FE61D990-4CEE-4AB7-B41E-7C3C7C9EDB6A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        SupatermNewTabRequest(
          startupCommand: nil,
          focus: false,
          target: .pane(paneID)
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
            == TerminalCreateTabRequest(
              startupCommand: nil,
              cwd: nil,
              focus: false,
              target: .pane(paneID)
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
  func newTabRequestMapsMissingSpaceToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "D44B2F87-72E6-4972-8E14-4E8DC7E6B3C5")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newTab(
        SupatermNewTabRequest(
          startupCommand: nil,
          focus: true,
          target: .space(UUID())
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
        == SocketReplyRecorder.Record(
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
      startupCommand: "pwd",
      cwd: "/tmp/example",
      direction: .down,
      focus: false,
      equalize: false,
      target: .pane(UUID(uuidString: "5E6C5EA2-F5FC-4CF5-A31D-4B12785A8694")!)
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
            == TerminalCreatePaneRequest(
              startupCommand: "pwd",
              cwd: "/tmp/example",
              direction: .down,
              focus: false,
              equalize: false,
              target: .pane(UUID(uuidString: "5E6C5EA2-F5FC-4CF5-A31D-4B12785A8694")!)
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
  func newPaneRequestMapsMissingTabToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "43F86918-86FD-4401-B0B8-444497BA544A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        SupatermNewPaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: true,
          equalize: true,
          target: .tab(UUID())
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
        == SocketReplyRecorder.Record(
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
  func newPaneRequestMapsMissingSpaceToNotFound() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "6BD0C483-E2AC-464A-81DF-D29134C9232D")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .newPane(
        SupatermNewPaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: true,
          equalize: true,
          target: .tab(UUID())
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
        == SocketReplyRecorder.Record(
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
