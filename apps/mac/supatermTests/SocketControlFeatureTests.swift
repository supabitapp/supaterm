import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureTests {
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

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.stop = {
        await recorder.recordStop()
      }
    }

    await store.send(.shutdown)

    #expect(await recorder.stopCount() == 1)
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
    let space = SupatermTreeSnapshot.Space(
      index: 1,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      spaces: [space]
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
      $0.terminalWindowsClient.treeSnapshot = { snapshot }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }

  @Test
  func onboardingRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "120B0BA1-4524-4C63-A0E6-CAC1327E7350")!
    let snapshot = SupatermOnboardingSnapshot(
      items: [
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
      ]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .onboarding(id: "onboarding-1")
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.onboardingSnapshot = { snapshot }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermOnboardingSnapshot.self) == snapshot)
  }

  @Test
  func debugRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "E8ECEDC8-C9D7-4127-9D7D-7C58A42C0F35")!
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "BEB80BB0-902E-4E56-AF34-A57A613F977A")!,
      tabID: UUID(uuidString: "3B9FB2DD-0C6E-4AE0-BE47-328F70A5A315")!
    )
    let snapshot = SupatermAppDebugSnapshot(
      build: .init(
        version: "1.2.3",
        buildNumber: "45",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: false
      ),
      update: .init(
        canCheckForUpdates: true,
        phase: "checking",
        detail: "Please wait while Supaterm checks for available updates."
      ),
      summary: .init(
        windowCount: 1,
        spaceCount: 0,
        tabCount: 0,
        paneCount: 0,
        keyWindowIndex: 1
      ),
      currentTarget: nil,
      windows: [],
      problems: ["No active windows."]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .debug(.init(context: context), id: "debug-1")
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.debugSnapshot = { request in
        #expect(request == .init(context: context))
        return snapshot
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermAppDebugSnapshot.self) == snapshot)
  }

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
      tabIndex: 3,
      paneIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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
      tabIndex: 2,
      paneIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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
      direction: .down,
      focus: false,
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
      tabIndex: 1,
      paneIndex: 3
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.createPane = { request in
        #expect(
          request
            == .init(
              command: "pwd",
              direction: .down,
              focus: false,
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
  func notifyRequestRepliesWithTargetedPaneAndDesktopNotification() async throws {
    let recorder = SocketReplyRecorder()
    let desktopNotificationRecorder = DesktopNotificationRecorder()
    let handle = UUID(uuidString: "165EBD38-E4CC-4D2D-8C17-3EB953C0BE7B")!
    let requestPayload = SupatermNotifyRequest(
      body: "Build finished",
      subtitle: "CI",
      targetPaneIndex: 2,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetWindowIndex: 1,
      title: "Deploy complete"
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .notify(requestPayload, id: "notify-1")
    )
    let expectedResult = SupatermNotifyResult(
      attentionState: .unread,
      desktopNotificationDisposition: .deliver,
      paneIndex: 2,
      resolvedTitle: "Deploy complete",
      spaceIndex: 2,
      tabIndex: 1,
      windowIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.notify = { request in
        #expect(
          request
            == .init(
              body: "Build finished",
              subtitle: "CI",
              target: .pane(windowIndex: 1, spaceIndex: 2, tabIndex: 1, paneIndex: 2),
              title: "Deploy complete"
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermNotifyResult.self) == expectedResult)
    #expect(
      await desktopNotificationRecorder.snapshot()
        == [.init(body: "Build finished", subtitle: "CI", title: "Deploy complete")]
    )
  }

  @Test
  func notifyRequestSkipsDesktopNotificationWhenPaneIsAlreadyFocused() async throws {
    let recorder = SocketReplyRecorder()
    let desktopNotificationRecorder = DesktopNotificationRecorder()
    let handle = UUID(uuidString: "C2930565-97D3-4E3B-8745-3EC7AE53C284")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .notify(
        .init(
          body: "Build finished",
          subtitle: "",
          targetSpaceIndex: 1,
          targetTabIndex: 1,
          targetWindowIndex: 1,
          title: "Deploy complete"
        ),
        id: "notify-2"
      )
    )
    let expectedResult = SupatermNotifyResult(
      attentionState: .focused,
      desktopNotificationDisposition: .suppressFocused,
      paneIndex: 1,
      resolvedTitle: "Deploy complete",
      spaceIndex: 1,
      tabIndex: 1,
      windowIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.notify = { request in
        #expect(
          request
            == .init(
              body: "Build finished",
              subtitle: "",
              target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1),
              title: "Deploy complete"
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermNotifyResult.self) == expectedResult)
    #expect(await desktopNotificationRecorder.snapshot().isEmpty)
  }

  @Test
  func notifyRequestWithoutTargetRepliesWithStructuredError() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "0EFD6A47-1B80-4478-9CA6-C0F0E08A4A0E")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .notify(
        .init(title: "Deploy complete"),
        id: "notify-3"
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
            id: "notify-3",
            code: "invalid_request",
            message: "Provide a target space and tab or run the command inside a Supaterm pane."
          )
        )
    )
  }

  @Test
  func notifyRequestWithoutTitleUsesResolvedTitleForDesktopNotification() async throws {
    let recorder = SocketReplyRecorder()
    let desktopNotificationRecorder = DesktopNotificationRecorder()
    let handle = UUID(uuidString: "EE8E0D84-181A-4A80-B3E7-2E3615969478")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .notify(
        .init(
          body: "Build finished",
          targetSpaceIndex: 1,
          targetTabIndex: 1
        ),
        id: "notify-4"
      )
    )
    let expectedResult = SupatermNotifyResult(
      attentionState: .unread,
      desktopNotificationDisposition: .deliver,
      paneIndex: 1,
      resolvedTitle: "Build",
      spaceIndex: 1,
      tabIndex: 1,
      windowIndex: 1
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.notify = { request in
        #expect(
          request
            == .init(
              body: "Build finished",
              subtitle: "",
              target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1),
              title: nil
            )
        )
        return expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(
      try records.first?.response.decodeResult(SupatermNotifyResult.self) == expectedResult
    )
    #expect(
      await desktopNotificationRecorder.snapshot()
        == [.init(body: "Build finished", subtitle: "", title: "Build")]
    )
  }

  @Test
  func claudeHookRequestRepliesWithOKAndDesktopNotification() async throws {
    let recorder = SocketReplyRecorder()
    let desktopNotificationRecorder = DesktopNotificationRecorder()
    let handle = UUID(uuidString: "0BFA1E47-4704-4E8A-A33D-3D1742681A9E")!
    let requestPayload = try ClaudeHookFixtures.request(
      ClaudeHookFixtures.notification,
      context: .init(
        surfaceID: UUID(uuidString: "44B71943-17BA-4D8B-B595-0EB650F8D762")!,
        tabID: UUID(uuidString: "BB4F5340-2947-4A4F-AD94-CF699B9C495A")!
      )
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .claudeHook(requestPayload, id: "claude-hook-1")
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.claudeHook = { payload in
        #expect(payload == requestPayload)
        return .init(
          desktopNotification: .init(
            body: "Claude needs your attention",
            subtitle: "Needs input",
            title: "Claude Code"
          )
        )
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(records.first?.response == .ok(id: "claude-hook-1"))
    #expect(
      await desktopNotificationRecorder.snapshot()
        == [.init(body: "Claude needs your attention", subtitle: "Needs input", title: "Claude Code")]
    )
  }

  @Test
  func claudeHookRequestMapsValidationErrorsToInvalidRequest() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "DCFBCE7F-6432-4DEA-A333-5D9A81E720B6")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .init(
        id: "claude-hook-2",
        method: SupatermSocketMethod.terminalClaudeHook,
        params: [:]
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
    let record = try #require(records.first)
    let response = record.response
    #expect(record.handle == handle)
    #expect(response.id == "claude-hook-2")
    #expect(response.ok == false)
    #expect(response.error?.code == "invalid_request")
    #expect(try #require(response.error?.message).isEmpty == false)
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
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
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
          targetTabIndex: 2
        ),
        id: "new-pane-5"
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
          targetWindowIndex: 1,
          targetSpaceIndex: 2
        ),
        id: "new-pane-6"
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
          targetWindowIndex: 1,
          targetSpaceIndex: 4,
          targetTabIndex: 1
        ),
        id: "new-pane-7"
      )
    )

    let store = TestStore(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
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

  @Test
  func unknownMethodRepliesWithStructuredError() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "B12602E1-5D37-470E-9388-55CD09D400CA")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .init(id: "request-2", method: "space.list")
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
            message: "Unknown method 'space.list'."
          )
        )
    )
  }

  @Test
  func onboardingRequestWithoutWindowRepliesWithStructuredError() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "7B0A8AAE-F4B3-48B6-B5CA-B9D9A7E55DA0")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .onboarding(id: "onboarding-2")
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
            id: "onboarding-2",
            code: "invalid_request",
            message: "No Supaterm window is available."
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

private actor StopRecorder {
  private var count = 0

  func recordStop() {
    count += 1
  }

  func stopCount() -> Int {
    count
  }
}

private actor DesktopNotificationRecorder {
  private var requests: [DesktopNotificationRequest] = []

  func record(_ request: DesktopNotificationRequest) {
    requests.append(request)
  }

  func snapshot() -> [DesktopNotificationRequest] {
    requests
  }
}
