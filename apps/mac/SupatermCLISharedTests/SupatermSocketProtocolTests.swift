import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketProtocolTests {
  @Test
  func requestAndResponseRoundTripAsJSON() throws {
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let request = SupatermSocketRequest(
      id: "request-1",
      method: SupatermSocketMethod.systemPing,
      params: [
        "nested": ["pong": true],
        "null": nil,
      ]
    )
    let response = SupatermSocketResponse.ok(
      id: "request-1",
      result: ["pong": true]
    )

    #expect(
      try decoder.decode(
        SupatermSocketRequest.self,
        from: encoder.encode(request)
      ) == request
    )
    #expect(
      try decoder.decode(
        SupatermSocketResponse.self,
        from: encoder.encode(response)
      ) == response
    )
  }

  @Test
  func identityRequestAndEndpointRoundTripThroughTypedHelpers() throws {
    let endpoint = SupatermSocketEndpoint(
      id: UUID(uuidString: "FC905729-0A5F-4D1D-8077-5E0E90529B86")!,
      name: "main",
      path: "/tmp/main.sock",
      pid: 77,
      startedAt: Date(timeIntervalSince1970: 3)
    )
    let request = SupatermSocketRequest.identity(id: "identity-1")
    let response = try SupatermSocketResponse.ok(id: "identity-1", encodableResult: endpoint)

    #expect(request.method == SupatermSocketMethod.systemIdentity)
    #expect(try response.decodeResult(SupatermSocketEndpoint.self) == endpoint)
  }

  @Test
  func treeRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let tab = SupatermTreeSnapshot.Tab(
      index: 1,
      id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      title: "zsh",
      isSelected: true,
      panes: [
        SupatermTreeSnapshot.Pane(
          index: 1,
          id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
          isFocused: true
        ),
        SupatermTreeSnapshot.Pane(
          index: 2,
          id: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!,
          isFocused: false
        ),
      ]
    )
    let space = SupatermTreeSnapshot.Space(
      index: 1,
      id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
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

    let request = SupatermSocketRequest.tree(id: "tree-1")
    let response = try SupatermSocketResponse.ok(id: "tree-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appTree)
    #expect(try response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }

  @Test
  func onboardingRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let snapshot = SupatermOnboardingSnapshot(
      items: [
        SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
        SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
      ]
    )

    let request = SupatermSocketRequest.onboarding(id: "onboarding-1")
    let response = try SupatermSocketResponse.ok(id: "onboarding-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appOnboarding)
    #expect(try response.decodeResult(SupatermOnboardingSnapshot.self) == snapshot)
  }

  @Test
  func debugRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "20D1A721-EA1E-44FB-B46D-29FBF240D4CB")!,
      tabID: UUID(uuidString: "9C643643-2288-42E1-88C1-79AFEF4D40CA")!
    )
    let pane = SupatermAppDebugSnapshot.Pane(
      index: 1,
      id: context.surfaceID,
      isFocused: true,
      displayTitle: "zsh",
      pwd: "/tmp",
      isReadOnly: false,
      hasSecureInput: false,
      bellCount: 0,
      isRunning: true,
      progressState: "indeterminate",
      progressValue: nil,
      needsCloseConfirmation: true,
      lastCommandExitCode: 0,
      lastCommandDurationMs: 120,
      lastChildExitCode: nil,
      lastChildExitTimeMs: nil
    )
    let tab = SupatermAppDebugSnapshot.Tab(
      index: 1,
      id: context.tabID,
      title: "zsh",
      isSelected: true,
      isPinned: false,
      isDirty: true,
      isTitleLocked: false,
      hasRunningActivity: true,
      hasBell: false,
      hasReadOnly: false,
      hasSecureInput: false,
      panes: [pane]
    )
    let space = SupatermAppDebugSnapshot.Space(
      index: 1,
      id: UUID(uuidString: "3006D18B-D5B7-47E5-9632-5BFD80C1FF21")!,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      isKey: true,
      isVisible: true,
      spaces: [space]
    )
    let snapshot = SupatermAppDebugSnapshot(
      build: SupatermAppDebugSnapshot.Build(
        version: "1.2.3",
        buildNumber: "45",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: true
      ),
      update: SupatermAppDebugSnapshot.Update(
        canCheckForUpdates: true,
        phase: "checking",
        detail: "Please wait while Supaterm checks for available updates."
      ),
      summary: SupatermAppDebugSnapshot.Summary(
        windowCount: 1,
        spaceCount: 1,
        tabCount: 1,
        paneCount: 1,
        keyWindowIndex: 1
      ),
      currentTarget: SupatermAppDebugSnapshot.CurrentTarget(
        windowIndex: 1,
        spaceIndex: 1,
        spaceID: space.id,
        spaceName: space.name,
        tabIndex: 1,
        tabID: context.tabID,
        tabTitle: tab.title,
        paneIndex: 1,
        paneID: context.surfaceID
      ),
      windows: [window],
      problems: []
    )

    let request = try SupatermSocketRequest.debug(
      SupatermDebugRequest(context: context),
      id: "debug-1"
    )
    let response = try SupatermSocketResponse.ok(id: "debug-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appDebug)
    #expect(try request.decodeParams(SupatermDebugRequest.self) == SupatermDebugRequest(context: context))
    #expect(try response.decodeResult(SupatermAppDebugSnapshot.self) == snapshot)
  }

  @Test
  func newTabRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewTabRequest(
      startupCommand: "pwd",
      cwd: "/tmp/example",
      focus: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2
    )
    let result = SupatermNewTabResult(
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

    let request = try SupatermSocketRequest.newTab(requestPayload, id: "new-tab-1")
    let response = try SupatermSocketResponse.ok(id: "new-tab-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewTab)
    #expect(try request.decodeParams(SupatermNewTabRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewTabResult.self) == result)
  }

  @Test
  func newPaneRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewPaneRequest(
      startupCommand: "pwd",
      cwd: "/tmp/example",
      direction: .down,
      focus: false,
      equalize: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetPaneIndex: 2
    )
    let result = SupatermNewPaneResult(
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

    let request = try SupatermSocketRequest.newPane(requestPayload, id: "new-pane-1")
    let response = try SupatermSocketResponse.ok(id: "new-pane-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewPane)
    #expect(try request.decodeParams(SupatermNewPaneRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewPaneResult.self) == result)
  }

  @Test
  func notifyRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNotifyRequest(
      body: "Build finished",
      subtitle: "CI",
      targetPaneIndex: 2,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetWindowIndex: 1,
      title: "Deploy complete"
    )
    let result = SupatermNotifyResult(
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

    let request = try SupatermSocketRequest.notify(requestPayload, id: "notify-1")
    let response = try SupatermSocketResponse.ok(id: "notify-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNotify)
    #expect(try request.decodeParams(SupatermNotifyRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNotifyResult.self) == result)
  }

  @Test
  func notifyRequestDecodingPreservesMissingTitle() throws {
    let request = SupatermSocketRequest(
      id: "notify-default-title",
      method: SupatermSocketMethod.terminalNotify,
      params: [
        "body": "Build finished",
        "targetSpaceIndex": 1,
        "targetTabIndex": 2,
      ]
    )

    #expect(
      try request.decodeParams(SupatermNotifyRequest.self)
        == SupatermNotifyRequest(
          body: "Build finished",
          targetSpaceIndex: 1,
          targetTabIndex: 2
        )
    )
  }

  @Test
  func agentHookRequestRoundTripsTypedPayload() throws {
    let event = SupatermAgentHookEvent(hookEventName: .preToolUse)
    let requestPayload = SupatermAgentHookRequest(
      agent: .claude,
      context: SupatermCLIContext(
        surfaceID: UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!,
        tabID: UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
      ),
      event: event,
      processID: 123
    )

    let request = try SupatermSocketRequest.agentHook(requestPayload, id: "agent-hook-1")

    #expect(request.method == SupatermSocketMethod.terminalAgentHook)
    #expect(try request.decodeParams(SupatermAgentHookRequest.self) == requestPayload)
  }

  @Test
  func paneControlRequestsRoundTripThroughTypedHelpers() throws {
    let paneTarget = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )
    let focusRequest = try SupatermSocketRequest.focusPane(
      SupatermPaneTargetRequest(
        targetWindowIndex: 1,
        targetSpaceIndex: 2,
        targetTabIndex: 3,
        targetPaneIndex: 4
      ),
      id: "focus-pane-1"
    )
    let focusResponse = try SupatermSocketResponse.ok(
      id: "focus-pane-1",
      encodableResult: SupatermFocusPaneResult(
        isFocused: true,
        isSelectedTab: true,
        target: paneTarget
      )
    )
    let sendTextRequest = try SupatermSocketRequest.sendText(
      SupatermSendTextRequest(
        target: SupatermPaneTargetRequest(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        ),
        text: "echo hello\n"
      ),
      id: "send-text-1"
    )
    let setPaneSizeRequest = try SupatermSocketRequest.setPaneSize(
      SupatermSetPaneSizeRequest(
        amount: 30,
        axis: .horizontal,
        target: SupatermPaneTargetRequest(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        ),
        unit: .percent
      ),
      id: "set-pane-size-1"
    )

    #expect(focusRequest.method == SupatermSocketMethod.terminalFocusPane)
    #expect(
      try focusRequest.decodeParams(SupatermPaneTargetRequest.self)
        == SupatermPaneTargetRequest(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        )
    )
    #expect(try focusResponse.decodeResult(SupatermFocusPaneResult.self).target == paneTarget)
    #expect(sendTextRequest.method == SupatermSocketMethod.terminalSendText)
    #expect(
      try sendTextRequest.decodeParams(SupatermSendTextRequest.self)
        == SupatermSendTextRequest(
          target: SupatermPaneTargetRequest(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          ),
          text: "echo hello\n"
        )
    )
    #expect(setPaneSizeRequest.method == SupatermSocketMethod.terminalSetPaneSize)
    #expect(
      try setPaneSizeRequest.decodeParams(SupatermSetPaneSizeRequest.self)
        == SupatermSetPaneSizeRequest(
          amount: 30,
          axis: .horizontal,
          target: SupatermPaneTargetRequest(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          ),
          unit: .percent
        )
    )
  }

  @Test
  func paneHealthRequestRoundTripsThroughTypedHelper() throws {
    let paneTarget = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )
    let request = try SupatermSocketRequest.paneHealth(
      SupatermPaneHealthRequest(
        target: SupatermPaneTargetRequest(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        )
      ),
      id: "pane-health-1"
    )
    let response = try SupatermSocketResponse.ok(
      id: "pane-health-1",
      encodableResult: SupatermPaneHealthResult(
        target: paneTarget,
        isReady: true,
        hasSurface: true,
        hasBridgeSurface: true,
        isAttachedToWindow: true,
        isWindowVisible: true,
        canCaptureText: true
      )
    )

    #expect(request.method == SupatermSocketMethod.terminalPaneHealth)
    #expect(
      try request.decodeParams(SupatermPaneHealthRequest.self)
        == SupatermPaneHealthRequest(
          target: SupatermPaneTargetRequest(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          )
        )
    )
    #expect(try response.decodeResult(SupatermPaneHealthResult.self).target == paneTarget)
    #expect(try response.decodeResult(SupatermPaneHealthResult.self).isReady)
  }

  @Test
  func spaceAndLayoutRequestsRoundTripThroughTypedHelpers() throws {
    let createSpaceRequest = try SupatermSocketRequest.createSpace(
      SupatermCreateSpaceRequest(
        name: "Build",
        target: SupatermSpaceNavigationRequest(targetWindowIndex: 1)
      ),
      id: "create-space-1"
    )
    let equalizeRequest = try SupatermSocketRequest.equalizePanes(
      SupatermTabTargetRequest(
        targetWindowIndex: 1,
        targetSpaceIndex: 2,
        targetTabIndex: 3
      ),
      id: "equalize-panes-1"
    )
    let tileRequest = try SupatermSocketRequest.tilePanes(
      SupatermTabTargetRequest(
        targetWindowIndex: 4,
        targetSpaceIndex: 5,
        targetTabIndex: 6
      ),
      id: "tile-panes-1"
    )
    let mainVerticalRequest = try SupatermSocketRequest.mainVerticalPanes(
      SupatermTabTargetRequest(
        targetWindowIndex: 7,
        targetSpaceIndex: 8,
        targetTabIndex: 9
      ),
      id: "main-vertical-panes-1"
    )

    #expect(createSpaceRequest.method == SupatermSocketMethod.terminalCreateSpace)
    #expect(
      try createSpaceRequest.decodeParams(SupatermCreateSpaceRequest.self)
        == SupatermCreateSpaceRequest(
          name: "Build",
          target: SupatermSpaceNavigationRequest(targetWindowIndex: 1)
        )
    )
    #expect(equalizeRequest.method == SupatermSocketMethod.terminalEqualizePanes)
    #expect(
      try equalizeRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
        )
    )
    #expect(tileRequest.method == SupatermSocketMethod.terminalTilePanes)
    #expect(
      try tileRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(
          targetWindowIndex: 4,
          targetSpaceIndex: 5,
          targetTabIndex: 6
        )
    )
    #expect(mainVerticalRequest.method == SupatermSocketMethod.terminalMainVerticalPanes)
    #expect(
      try mainVerticalRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(
          targetWindowIndex: 7,
          targetSpaceIndex: 8,
          targetTabIndex: 9
        )
    )
  }

  @Test
  func sendKeyRequestRoundTripsThroughTypedHelper() throws {
    let request = try SupatermSocketRequest.sendKey(
      SupatermSendKeyRequest(
        key: .enter,
        target: SupatermPaneTargetRequest(
          targetWindowIndex: 7,
          targetSpaceIndex: 8,
          targetTabIndex: 9,
          targetPaneIndex: 10
        )
      ),
      id: "send-key-1"
    )

    #expect(request.method == SupatermSocketMethod.terminalSendKey)
    #expect(
      try request.decodeParams(SupatermSendKeyRequest.self)
        == SupatermSendKeyRequest(
          key: .enter,
          target: SupatermPaneTargetRequest(
            targetWindowIndex: 7,
            targetSpaceIndex: 8,
            targetTabIndex: 9,
            targetPaneIndex: 10
          )
        )
    )
  }
}
