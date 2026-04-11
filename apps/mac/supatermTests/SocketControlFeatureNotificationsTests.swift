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
struct SocketControlFeatureNotificationsTests {
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
    resolvedTitle: "Deploy complete",
    windowIndex: 1,
    spaceIndex: 2,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 1,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 2,
    paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
  )

  await withDependencies {
    $0.defaultFileStorage = .inMemory
  } operation: {
    @Shared(.supatermSettings) var supatermSettings = .default
    $supatermSettings.withLock {
      $0.systemNotificationsEnabled = true
    }

    let store = makeStore {
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
    let decodedResult = try? records.first?.response.decodeResult(SupatermNotifyResult.self)
    #expect(decodedResult == expectedResult)
    #expect(
      await desktopNotificationRecorder.snapshot()
        == [.init(body: "Build finished", subtitle: "CI", title: "Deploy complete")]
    )
  }
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
    attentionState: .unread,
    desktopNotificationDisposition: .suppressFocused,
    resolvedTitle: "Deploy complete",
    windowIndex: 1,
    spaceIndex: 1,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 1,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 1,
    paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
  )

  let store = makeStore {
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
func notifyRequestSkipsDesktopNotificationWhenDisabledInPrefs() async throws {
  let recorder = SocketReplyRecorder()
  let desktopNotificationRecorder = DesktopNotificationRecorder()
  let handle = UUID(uuidString: "A94E8C30-A0D7-46B3-8E68-87156E28EB1D")!
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
    payload: try .notify(requestPayload, id: "notify-disabled")
  )
  let expectedResult = SupatermNotifyResult(
    attentionState: .unread,
    desktopNotificationDisposition: .deliver,
    resolvedTitle: "Deploy complete",
    windowIndex: 1,
    spaceIndex: 2,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 1,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 2,
    paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
  )

  await withDependencies {
    $0.defaultFileStorage = .inMemory
  } operation: {
    let store = makeStore {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.notify = { _ in
        expectedResult
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    let decodedResult = try? records.first?.response.decodeResult(SupatermNotifyResult.self)
    #expect(decodedResult == expectedResult)
    #expect(await desktopNotificationRecorder.snapshot().isEmpty)
  }
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
    resolvedTitle: "Build",
    windowIndex: 1,
    spaceIndex: 1,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 1,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 1,
    paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
  )

  await withDependencies {
    $0.defaultFileStorage = .inMemory
  } operation: {
    @Shared(.supatermSettings) var supatermSettings = .default
    $supatermSettings.withLock {
      $0.systemNotificationsEnabled = true
    }

    let store = makeStore {
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
    let decodedResult = try? records.first?.response.decodeResult(SupatermNotifyResult.self)
    #expect(decodedResult == expectedResult)
    #expect(
      await desktopNotificationRecorder.snapshot()
        == [.init(body: "Build finished", subtitle: "", title: "Build")]
    )
  }
}
@Test
func agentHookRequestRepliesWithOKAndDesktopNotification() async throws {
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
    payload: try .agentHook(requestPayload, id: "agent-hook-1")
  )

  await withDependencies {
    $0.defaultFileStorage = .inMemory
  } operation: {
    @Shared(.supatermSettings) var supatermSettings = .default
    $supatermSettings.withLock {
      $0.systemNotificationsEnabled = true
    }

    let store = makeStore {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.agentHook = { payload in
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
    let expectedNotification = DesktopNotificationRequest(
      body: "Claude needs your attention",
      subtitle: "Needs input",
      title: "Claude Code"
    )
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(records.first?.response == .ok(id: "agent-hook-1"))
    #expect(await desktopNotificationRecorder.snapshot() == [expectedNotification])
  }
}
@Test
func agentHookRequestSkipsDesktopNotificationWhenDisabledInPrefs() async throws {
  let recorder = SocketReplyRecorder()
  let desktopNotificationRecorder = DesktopNotificationRecorder()
  let handle = UUID(uuidString: "563E9698-BBCD-46C1-8C66-3B104D899CD7")!
  let requestPayload = try ClaudeHookFixtures.request(
    ClaudeHookFixtures.notification,
    context: .init(
      surfaceID: UUID(uuidString: "44B71943-17BA-4D8B-B595-0EB650F8D762")!,
      tabID: UUID(uuidString: "BB4F5340-2947-4A4F-AD94-CF699B9C495A")!
    )
  )
  let request = SocketControlClient.Request(
    handle: handle,
    payload: try .agentHook(requestPayload, id: "agent-hook-disabled")
  )

  await withDependencies {
    $0.defaultFileStorage = .inMemory
  } operation: {
    let store = makeStore {
      $0.desktopNotificationClient.deliver = { request in
        await desktopNotificationRecorder.record(request)
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.agentHook = { payload in
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
    #expect(records.first?.response == .ok(id: "agent-hook-disabled"))
    #expect(await desktopNotificationRecorder.snapshot().isEmpty)
  }
}
@Test
func agentHookRequestMapsValidationErrorsToInvalidRequest() async throws {
  let recorder = SocketReplyRecorder()
  let handle = UUID(uuidString: "DCFBCE7F-6432-4DEA-A333-5D9A81E720B6")!
  let request = SocketControlClient.Request(
    handle: handle,
    payload: .init(
      id: "agent-hook-2",
      method: SupatermSocketMethod.terminalAgentHook,
      params: [:]
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
  let record = try #require(records.first)
  let response = record.response
  #expect(record.handle == handle)
  #expect(response.id == "agent-hook-2")
  #expect(response.ok == false)
  #expect(response.error?.code == "invalid_request")
  #expect(try #require(response.error?.message).isEmpty == false)
}
}
