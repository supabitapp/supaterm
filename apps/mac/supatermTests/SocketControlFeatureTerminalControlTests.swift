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
struct SocketControlFeatureTerminalControlTests {
  @Test
  func focusPaneRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "7E905D56-4261-4B60-908D-DF245BB5B3C8")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .focusPane(
        .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        ),
        id: "focus-pane-1"
      )
    )
    let result = SupatermFocusPaneResult(
      isFocused: true,
      isSelectedTab: true,
      target: .init(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        tabIndex: 3,
        tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
        paneIndex: 4,
        paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.focusPane = { target in
        #expect(
          target
            == .pane(
              windowIndex: 1,
              spaceIndex: 2,
              tabIndex: 3,
              paneIndex: 4
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermFocusPaneResult.self) == result)
  }
  @Test
  func equalizePanesRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "31C9312F-27E1-470C-BFE7-10A85F8F3B2B")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .equalizePanes(
        .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
        ),
        id: "equalize-panes-1"
      )
    )
    let result = SupatermTabTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      title: "Logs"
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.equalizePanes = { request in
        #expect(
          request
            == .init(
              target: .tab(
                windowIndex: 1,
                spaceIndex: 2,
                tabIndex: 3
              )
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTabTarget.self) == result)
  }
  @Test
  func mainVerticalPanesRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "6D9F64D1-4C89-4CE5-8CA4-D5B8C1E4E4A2")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .mainVerticalPanes(
        .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
        ),
        id: "main-vertical-panes-1"
      )
    )
    let result = SupatermTabTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      title: "Workers"
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.mainVerticalPanes = { request in
        #expect(
          request
            == .init(
              target: .tab(
                windowIndex: 1,
                spaceIndex: 2,
                tabIndex: 3
              )
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTabTarget.self) == result)
  }
  @Test
  func setPaneSizeRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "948F2A06-0726-4D1C-9F55-C6BA5740F356")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .setPaneSize(
        .init(
          amount: 30,
          axis: .horizontal,
          target: .init(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          ),
          unit: .percent
        ),
        id: "set-pane-size-1"
      )
    )
    let result = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.setPaneSize = { request in
        #expect(
          request
            == .init(
              amount: 30,
              axis: .horizontal,
              target: .pane(
                windowIndex: 1,
                spaceIndex: 2,
                tabIndex: 3,
                paneIndex: 4
              ),
              unit: .percent
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPaneTarget.self) == result)
  }
  @Test
  func sendKeyRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "5D6996B2-28D4-4B30-9CDB-F18FD939E7B2")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .sendKey(
        .init(
          key: .enter,
          target: .init(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          )
        ),
        id: "send-key-1"
      )
    )
    let result = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.sendKey = { request in
        #expect(
          request
            == .init(
              key: .enter,
              target: .pane(
                windowIndex: 1,
                spaceIndex: 2,
                tabIndex: 3,
                paneIndex: 4
              )
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPaneTarget.self) == result)
  }
  @Test
  func tilePanesRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "6B4FE4C0-4D0E-4205-8D07-66C5EAB4AC0A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .tilePanes(
        .init(
          targetWindowIndex: 2,
          targetSpaceIndex: 3,
          targetTabIndex: 4
        ),
        id: "tile-panes-1"
      )
    )
    let result = SupatermTabTarget(
      windowIndex: 2,
      spaceIndex: 3,
      spaceID: UUID(uuidString: "9BA8A4E7-1958-48F5-BD2D-607552A3430E")!,
      tabIndex: 4,
      tabID: UUID(uuidString: "EB066866-4BA8-4789-88CE-FB75A921EA0F")!,
      title: "Workers"
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.tilePanes = { request in
        #expect(
          request
            == .init(
              target: .tab(
                windowIndex: 2,
                spaceIndex: 3,
                tabIndex: 4
              )
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTabTarget.self) == result)
  }
  @Test
  func createSpaceRequestRepliesWithSelection() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "1E24A0F8-5D9C-4C72-91E4-43F0F31C422F")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .createSpace(
        .init(
          name: "Build",
          target: .init(targetWindowIndex: 1)
        ),
        id: "create-space-1"
      )
    )
    let result = SupatermCreateSpaceResult(
      isFocused: true,
      isSelectedSpace: true,
      isSelectedTab: true,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
      tabIndex: 1,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      target: .init(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        name: "Build"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createSpace = { request in
        #expect(
          request
            == .init(
              name: "Build",
              target: .init(
                contextPaneID: nil,
                windowIndex: 1
              )
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermCreateSpaceResult.self) == result)
  }
  @Test
  func createSpaceRequestRejectsDuplicateName() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "792A3E3C-9698-4175-B6F7-066A79CE2AE4")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .createSpace(
        .init(
          name: "Build",
          target: .init(targetWindowIndex: 1)
        ),
        id: "create-space-duplicate"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createSpace = { _ in
        throw TerminalControlError.spaceNameUnavailable
      }
    }

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "Space name is already in use.")
  }
  @Test
  func closeSpaceRequestRejectsOnlyRemainingSpace() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "8BD6B25E-4EC6-425F-B5B9-28E37B8F7AB9")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .closeSpace(
        .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 1
        ),
        id: "close-space-last"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.closeSpace = { _ in
        throw TerminalControlError.onlyRemainingSpace
      }
    }

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "Cannot close the only remaining space.")
  }
  @Test
  func nextTabRequestRepliesWithSelection() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "B1B93F7A-0B86-4C42-B784-A84A56432530")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .nextTab(
        .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2
        ),
        id: "next-tab-1"
      )
    )
    let result = SupatermSelectTabResult(
      isFocused: true,
      isSelectedSpace: true,
      isSelectedTab: true,
      isTitleLocked: false,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
      target: .init(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        tabIndex: 3,
        tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
        title: "Logs"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.nextTab = { request in
        #expect(
          request
            == .init(
              contextPaneID: nil,
              spaceIndex: 2,
              windowIndex: 1
            )
        )
        return result
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermSelectTabResult.self) == result)
  }
}
