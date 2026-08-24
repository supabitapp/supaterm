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
        SupatermPaneTargetRequest(
          paneID: controlPaneID
        ),
        id: "focus-pane-1"
      )
    )
    let result = SupatermFocusPaneResult(
      isFocused: true,
      isSelectedTab: true,
      target: SupatermPaneTarget(
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
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .focusPane(let target) = execution else {
          Issue.record("Expected focus pane request")
          throw CancellationError()
        }
        #expect(
          target == TerminalPaneTarget(paneID: controlPaneID)
        )
        return .focusPane(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermFocusPaneResult.self) == result)
  }

  @Test
  func paneHealthRequestRepliesWithResolvedHealth() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "44C38F69-421B-4BB7-93C7-902BDDB74B1F")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .paneHealth(
        SupatermPaneHealthRequest(
          target: SupatermPaneTargetRequest(
            paneID: controlPaneID
          )
        ),
        id: "pane-health-1"
      )
    )
    let result = SupatermPaneHealthResult(
      target: SupatermPaneTarget(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        tabIndex: 3,
        tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
        paneIndex: 4,
        paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
      ),
      isReady: true,
      hasSurface: true,
      hasBridgeSurface: true,
      isAttachedToWindow: true,
      isWindowVisible: true,
      canCaptureText: true
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .paneHealth(let request) = execution else {
          Issue.record("Expected pane health request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalPaneHealthRequest(
              target: TerminalPaneTarget(paneID: controlPaneID)
            )
        )
        return .paneHealth(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPaneHealthResult.self) == result)
  }

  @Test
  func equalizePanesRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "31C9312F-27E1-470C-BFE7-10A85F8F3B2B")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .equalizePanes(
        SupatermTabTargetRequest(
          tabID: controlTabID
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
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .equalizePanes(let request) = execution else {
          Issue.record("Expected equalize panes request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalEqualizePanesRequest(
              target: TerminalTabTarget(tabID: controlTabID)
            )
        )
        return .equalizePanes(result)
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
        SupatermTabTargetRequest(
          tabID: controlTabID
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
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .mainVerticalPanes(let request) = execution else {
          Issue.record("Expected main vertical panes request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalMainVerticalPanesRequest(
              target: TerminalTabTarget(tabID: controlTabID)
            )
        )
        return .mainVerticalPanes(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTabTarget.self) == result)
  }

  @Test
  func pinTabRequestRepliesWithPinnedState() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "32EC00A0-B07B-4309-BBBF-D4CC28A83DA9")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .pinTab(
        SupatermTabTargetRequest(
          tabID: controlTabID
        ),
        id: "pin-tab-1"
      )
    )
    let result = SupatermPinTabResult(
      isPinned: true,
      target: SupatermTabTarget(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        tabIndex: 1,
        tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
        title: "Logs"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .pinTab(let target) = execution else {
          Issue.record("Expected pin tab request")
          throw CancellationError()
        }
        #expect(
          target == TerminalTabTarget(tabID: controlTabID)
        )
        return .pinTab(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPinTabResult.self) == result)
  }

  @Test
  func unpinTabRequestRepliesWithPinnedState() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "A3C0A4B2-AE73-42F1-B718-6C88A6BF8EC4")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .unpinTab(
        SupatermTabTargetRequest(
          tabID: controlTabID
        ),
        id: "unpin-tab-1"
      )
    )
    let result = SupatermPinTabResult(
      isPinned: false,
      target: SupatermTabTarget(
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
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .unpinTab(let target) = execution else {
          Issue.record("Expected unpin tab request")
          throw CancellationError()
        }
        #expect(
          target == TerminalTabTarget(tabID: controlTabID)
        )
        return .unpinTab(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPinTabResult.self) == result)
  }

  @Test
  func setPaneSizeRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "948F2A06-0726-4D1C-9F55-C6BA5740F356")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .setPaneSize(
        SupatermSetPaneSizeRequest(
          amount: 30,
          axis: .horizontal,
          target: SupatermPaneTargetRequest(
            paneID: controlPaneID
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
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .setPaneSize(let request) = execution else {
          Issue.record("Expected set pane size request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalSetPaneSizeRequest(
              amount: 30,
              axis: .horizontal,
              target: TerminalPaneTarget(paneID: controlPaneID),
              unit: .percent
            )
        )
        return .setPaneSize(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPaneTarget.self) == result)
  }

  @Test
  func submitTextRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "AF2EAB5B-F467-47ED-9762-CCB118E705C4")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .sendText(
        SupatermSendTextRequest(
          mode: .submit,
          target: SupatermPaneTargetRequest(
            paneID: controlPaneID
          ),
          text: "first\nsecond"
        ),
        id: "submit-text-1"
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
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .sendText(let request) = execution else {
          Issue.record("Expected send text request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalSendTextRequest(
              mode: .submit,
              target: TerminalPaneTarget(paneID: controlPaneID),
              text: "first\nsecond"
            )
        )
        return .sendText(result)
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
        SupatermSendKeyRequest(
          key: .enter,
          target: SupatermPaneTargetRequest(
            paneID: controlPaneID
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
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .sendKey(let request) = execution else {
          Issue.record("Expected send key request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalSendKeyRequest(
              key: .enter,
              target: TerminalPaneTarget(paneID: controlPaneID)
            )
        )
        return .sendKey(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermPaneTarget.self) == result)
  }

  @Test(arguments: [0, -1, Int(UInt32.max) + 1])
  func capturePaneRequestRejectsInvalidLines(_ lines: Int) async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .capturePane(
        SupatermCapturePaneRequest(
          lines: lines,
          scope: .scrollback,
          target: SupatermPaneTargetRequest(paneID: controlPaneID)
        ),
        id: "capture-pane-invalid-lines"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(
      response.error?.message
        == "Capture lines must be between 1 and \(UInt32.max), not \(lines)."
    )
  }

  @Test
  func agentExplainRequestRepliesWithRuleEvidence() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .agentDetectionExplain(
        SupatermAgentDetectionExplainRequest(
          target: SupatermPaneTargetRequest(paneID: controlPaneID)
        ),
        id: "agent-explain-1"
      )
    )
    let target = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: controlPaneID
    )
    let result = SupatermAgentDetectionExplainResult(
      target: target,
      status: .resolved,
      generation: 42,
      agentID: "codex",
      displayName: "Codex",
      phase: .running,
      process: nil,
      manifest: nil,
      matchedRuleID: "working",
      publishedRuleID: "working",
      rules: []
    )
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .agentExplain(let target) = execution else {
          Issue.record("Expected agent explain request")
          throw CancellationError()
        }
        #expect(target == TerminalPaneTarget(paneID: controlPaneID))
        return .agentExplain(result)
      }
    }

    await store.send(.requestReceived(request))

    let record = try #require(await recorder.snapshot().first)
    #expect(try record.response.decodeResult(SupatermAgentDetectionExplainResult.self) == result)
  }

  @Test
  func screenshotPaneRequestRepliesWithPNGData() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .screenshotPane(
        SupatermPaneTargetRequest(paneID: controlPaneID),
        id: "screenshot-pane-1"
      )
    )
    let result = SupatermScreenshotPaneResult(
      target: SupatermPaneTarget(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
        tabIndex: 3,
        tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
        paneIndex: 4,
        paneID: controlPaneID
      ),
      pngData: Data([0x89, 0x50, 0x4E, 0x47])
    )
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .screenshotPane(let target) = execution else {
          Issue.record("Expected screenshot pane request")
          throw CancellationError()
        }
        #expect(target == TerminalPaneTarget(paneID: controlPaneID))
        return .screenshotPane(result)
      }
    }

    await store.send(.requestReceived(request))

    let record = try #require(await recorder.snapshot().first)
    #expect(record.handle == handle)
    #expect(try record.response.decodeResult(SupatermScreenshotPaneResult.self) == result)
  }

  @Test
  func tilePanesRequestRepliesWithResolvedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "6B4FE4C0-4D0E-4205-8D07-66C5EAB4AC0A")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .tilePanes(
        SupatermTabTargetRequest(
          tabID: tileTabID
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
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .tilePanes(let request) = execution else {
          Issue.record("Expected tile panes request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalTilePanesRequest(
              target: TerminalTabTarget(tabID: tileTabID)
            )
        )
        return .tilePanes(result)
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
        SupatermCreateSpaceRequest(color: nil, name: "Build", context: controlContext),
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
      target: SupatermSpaceTarget(
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
      $0.socketRequestExecutor.executeTerminalSpace = { execution in
        guard case .createSpace(let request) = execution else {
          Issue.record("Expected create space request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalCreateSpaceRequest(color: nil, name: "Build", context: controlContext)
        )
        return .createSpace(result)
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
        SupatermCreateSpaceRequest(color: nil, name: "Build", context: controlContext),
        id: "create-space-duplicate"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalSpace = { execution in
        guard case .createSpace = execution else {
          Issue.record("Expected create space request")
          throw CancellationError()
        }
        throw TerminalControlError.spaceNameUnavailable
      }
    }

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "Space name is already in use.")
  }
  @Test
  func setSpaceColorRequestRepliesWithTarget() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "4C0E17D2-95E7-4A6B-8E52-6B0A2E51D274")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .setSpaceColor(
        SupatermSetSpaceColorRequest(
          color: .green,
          target: SupatermSpaceTargetRequest(spaceID: controlSpaceID)
        ),
        id: "set-space-color-1"
      )
    )
    let result = SupatermSpaceTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: controlSpaceID,
      name: "Build"
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalSpace = { execution in
        guard case .setSpaceColor(let request) = execution else {
          Issue.record("Expected set space color request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalSetSpaceColorRequest(
              color: .green,
              target: TerminalSpaceTarget(spaceID: controlSpaceID)
            )
        )
        return .setSpaceColor(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermSpaceTarget.self) == result)
  }
  @Test
  func setSpaceColorRequestRejectsUnknownSpace() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "0D0B7A38-30E2-49AF-95AC-2B4F5FE7D611")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .setSpaceColor(
        SupatermSetSpaceColorRequest(
          color: .purple,
          target: SupatermSpaceTargetRequest(spaceID: controlSpaceID)
        ),
        id: "set-space-color-unknown"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalSpace = { execution in
        guard case .setSpaceColor = execution else {
          Issue.record("Expected set space color request")
          throw CancellationError()
        }
        throw TerminalControlError.contextPaneNotFound
      }
    }

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error != nil)
  }
  @Test
  func closeSpaceRequestRejectsOnlyRemainingSpace() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "8BD6B25E-4EC6-425F-B5B9-28E37B8F7AB9")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .closeSpace(
        SupatermSpaceTargetRequest(
          spaceID: controlSpaceID
        ),
        id: "close-space-last"
      )
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalSpace = { execution in
        guard case .closeSpace = execution else {
          Issue.record("Expected close space request")
          throw CancellationError()
        }
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
        SupatermTabNavigationRequest(
          spaceID: controlSpaceID
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
      target: SupatermTabTarget(
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
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .nextTab(let request) = execution else {
          Issue.record("Expected next tab request")
          throw CancellationError()
        }
        #expect(
          request
            == TerminalTabNavigationRequest(spaceID: controlSpaceID)
        )
        return .nextTab(result)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermSelectTabResult.self) == result)
  }
}

private let controlSpaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
private let controlTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
private let controlPaneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
private let controlContext = SupatermCLIContext(surfaceID: controlPaneID, tabID: controlTabID)
private let tileTabID = UUID(uuidString: "EB066866-4BA8-4789-88CE-FB75A921EA0F")!
