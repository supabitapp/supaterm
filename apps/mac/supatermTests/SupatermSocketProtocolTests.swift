import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

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
    let errorResponse = SupatermSocketResponse.error(
      code: "failed",
      message: "Failed."
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
    #expect(
      try decoder.decode(
        SupatermSocketResponse.self,
        from: encoder.encode(errorResponse)
      ) == errorResponse
    )
  }

  @Test(arguments: [
    #"{"ok":true,"result":{}}"#,
    #"{"id":"request-1","ok":true}"#,
    #"{"id":"request-1","ok":true,"result":{},"error":{"code":"failed","message":"Failed."}}"#,
    #"{"id":"request-1","ok":false}"#,
    #"{"id":"request-1","ok":false,"result":{},"error":{"code":"failed","message":"Failed."}}"#,
  ])
  func responseRejectsInvalidOutcome(json: String) {
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermSocketResponse.self, from: Data(json.utf8))
    }
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
      color: .green,
      isWarm: true,
      rootItems: [
        .group(
          SupatermTreeSnapshot.Group(
            color: .blue,
            id: UUID(uuidString: "F08C721E-A7E9-4A7C-B350-944EDB986FA2")!,
            isCollapsed: true,
            isPinned: false,
            title: "Work",
            tabs: [tab]
          )
        ),
        .tab(SupatermTreeSnapshot.RootTab(isPinned: true, tab: tab)),
      ]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      displayedSpaceID: space.id,
      spaces: [space]
    )
    let snapshot = SupatermTreeSnapshot(
      windows: [window]
    )

    let request = SupatermSocketRequest.tree(id: "tree-1")
    let response = try SupatermSocketResponse.ok(id: "tree-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appTree)
    #expect(try response.decodeResult(SupatermTreeSnapshot.self) == snapshot)

    let json = try #require(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as? [String: Any]
    )
    let windows = try #require(json["windows"] as? [[String: Any]])
    #expect(
      windows.first?["displayedSpaceID"] as? String == "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497"
    )
    let spaces = try #require(windows.first?["spaces"] as? [[String: Any]])
    #expect(spaces.first?["color"] as? String == "green")
    #expect(spaces.first?["isWarm"] as? Bool == true)
    let rootItems = try #require(spaces.first?["rootItems"] as? [[String: Any]])
    let group = try #require(rootItems.first)
    #expect(group["kind"] as? String == "group")
    #expect(group["title"] as? String == "Work")
    #expect(group["color"] as? String == "blue")
    #expect(group["group"] == nil)
    #expect((try #require(group["tabs"] as? [[String: Any]])).first?["index"] == nil)
    let rootTab = try #require(rootItems.dropFirst().first)
    #expect(rootTab["kind"] as? String == "tab")
    #expect(rootTab["isPinned"] as? Bool == true)
    #expect(rootTab["tab"] is [String: Any])
    #expect(rootTab["tabs"] == nil)
    #expect(rootTab["group"] == nil)
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
      lastChildExitTimeMs: nil,
      foregroundProcessGroupID: 4_242,
      ttyName: "/dev/ttys001"
    )
    let tab = SupatermAppDebugSnapshot.Tab(
      id: context.tabID,
      title: "zsh",
      isSelected: true,
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
      color: .neutral,
      isWarm: true,
      rootItems: [.tab(SupatermAppDebugSnapshot.RootTab(isPinned: false, tab: tab))]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      isKey: true,
      isVisible: true,
      displayedSpaceID: space.id,
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
  func agentDetectionRequestsRoundTripThroughTypedHelpers() throws {
    let reloadRequest = SupatermSocketRequest.agentDetectionReload(id: "agent-reload-1")
    let reloadResult = SupatermAgentDetectionReloadResult(
      generation: 42,
      overrideDirectory: "/tmp/agent-detection",
      manifests: [
        SupatermAgentDetectionManifestInfo(
          agentID: "codex",
          displayName: "Codex",
          version: "local.1",
          origin: .local,
          path: "/tmp/agent-detection/codex.toml"
        )
      ]
    )
    let response = try SupatermSocketResponse.ok(
      id: "agent-reload-1",
      encodableResult: reloadResult
    )

    #expect(reloadRequest.method == SupatermSocketMethod.appAgentDetectionReload)
    #expect(reloadRequest.params.isEmpty)
    #expect(try response.decodeResult(SupatermAgentDetectionReloadResult.self) == reloadResult)
  }

  @Test
  func settingsRequestsRoundTripThroughTypedHelpers() throws {
    let listRequest = try SupatermSocketRequest.settingsList(
      SupatermSettingsListRequest(changedOnly: true),
      id: "settings-list-1"
    )
    let getRequest = try SupatermSocketRequest.settingsGet(
      SupatermSettingsGetRequest(key: "updates.channel"),
      id: "settings-get-1"
    )
    let setRequest = try SupatermSocketRequest.settingsSet(
      SupatermSettingsSetRequest(key: "appearance.mode", value: "system"),
      id: "settings-set-1"
    )
    let resetRequest = try SupatermSocketRequest.settingsReset(
      SupatermSettingsResetRequest(key: "privacy.analytics_enabled"),
      id: "settings-reset-1"
    )
    let listResult = SupatermSettingsRegistry.list(
      settings: .default,
      path: "/tmp/settings.toml",
      changedOnly: true
    )
    let response = try SupatermSocketResponse.ok(id: "settings-list-1", encodableResult: listResult)

    #expect(listRequest.method == SupatermSocketMethod.appSettingsList)
    #expect(getRequest.method == SupatermSocketMethod.appSettingsGet)
    #expect(setRequest.method == SupatermSocketMethod.appSettingsSet)
    #expect(resetRequest.method == SupatermSocketMethod.appSettingsReset)
    #expect(try listRequest.decodeParams(SupatermSettingsListRequest.self).changedOnly)
    #expect(try getRequest.decodeParams(SupatermSettingsGetRequest.self).key == "updates.channel")
    #expect(try setRequest.decodeParams(SupatermSettingsSetRequest.self).value == "system")
    #expect(try resetRequest.decodeParams(SupatermSettingsResetRequest.self).key == "privacy.analytics_enabled")
    #expect(try response.decodeResult(SupatermSettingsListResult.self) == listResult)
  }

  @Test
  func licenseRequestsAndResultsRoundTripThroughTypedHelpers() throws {
    let activation = try SupatermSocketRequest.licenseActivate(
      SupatermLicenseActivationRequest(key: "license-key"),
      id: "license-activate-1"
    )
    let status = SupatermLicenseStatusResult(
      mode: .paid,
      updatesThrough: "2027-08-21",
      deviceName: "Test Mac",
      openTabCount: 3
    )
    let response = try SupatermSocketResponse.ok(
      id: "license-activate-1",
      encodableResult: status
    )

    #expect(activation.method == SupatermSocketMethod.licenseActivate)
    #expect(
      try activation.decodeParams(SupatermLicenseActivationRequest.self)
        == SupatermLicenseActivationRequest(key: "license-key")
    )
    #expect(SupatermSocketRequest.licenseStatus().method == SupatermSocketMethod.licenseStatus)
    #expect(SupatermSocketRequest.licenseDeactivate().method == SupatermSocketMethod.licenseDeactivate)
    #expect(SupatermSocketRequest.licenseRefresh().method == SupatermSocketMethod.licenseRefresh)
    #expect(SupatermSocketRequest.licenseBuy().method == SupatermSocketMethod.licenseBuy)
    #expect(SupatermSocketRequest.licenseRenew().method == SupatermSocketMethod.licenseRenew)
    #expect(try response.decodeResult(SupatermLicenseStatusResult.self) == status)
  }

  @Test
  func newTabRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let requestPayload = SupatermNewTabRequest(
      startupCommand: .exec(["pwd"], searchPath: "/usr/bin:/bin"),
      cwd: "/tmp/example",
      focus: false,
      target: .space(spaceID)
    )
    let result = SupatermNewTabResult(
      isFocused: false,
      isSelectedSpace: false,
      isSelectedTab: false,
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: spaceID,
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
  func movePaneToNewTabRequestUsesTypedHelper() throws {
    let payload = SupatermPaneTargetRequest(
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let request = try SupatermSocketRequest.movePaneToNewTab(
      payload,
      id: "move-pane-to-new-tab-1"
    )

    #expect(request.method == SupatermSocketMethod.terminalMovePaneToNewTab)
    #expect(try request.decodeParams(SupatermPaneTargetRequest.self) == payload)
  }

  @Test
  func newPaneRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let requestPayload = SupatermNewPaneRequest(
      startupCommand: .exec(["pwd"], searchPath: "/usr/bin:/bin"),
      cwd: "/tmp/example",
      direction: .down,
      focus: false,
      equalize: false,
      target: .pane(paneID)
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
    let paneID = UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    let requestPayload = SupatermNotifyRequest(
      body: "Build finished",
      paneID: paneID,
      subtitle: "CI",
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
      paneID: paneID
    )

    let request = try SupatermSocketRequest.notify(requestPayload, id: "notify-1")
    let response = try SupatermSocketResponse.ok(id: "notify-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNotify)
    #expect(try request.decodeParams(SupatermNotifyRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNotifyResult.self) == result)
  }

  @Test
  func notifyRequestDecodingPreservesMissingTitle() throws {
    let paneID = UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    let request = SupatermSocketRequest(
      id: "notify-default-title",
      method: SupatermSocketMethod.terminalNotify,
      params: [
        "body": "Build finished",
        "paneID": .string(paneID.uuidString),
        "subtitle": "",
      ]
    )

    #expect(
      try request.decodeParams(SupatermNotifyRequest.self)
        == SupatermNotifyRequest(
          body: "Build finished",
          paneID: paneID
        )
    )
  }

  @Test
  func paneControlRequestsRoundTripThroughTypedHelpers() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let paneTarget = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: paneID
    )
    let focusRequest = try SupatermSocketRequest.focusPane(
      SupatermPaneTargetRequest(paneID: paneID),
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
    let setPaneSizeRequest = try SupatermSocketRequest.setPaneSize(
      SupatermSetPaneSizeRequest(
        amount: 30,
        axis: .horizontal,
        target: SupatermPaneTargetRequest(paneID: paneID),
        unit: .percent
      ),
      id: "set-pane-size-1"
    )

    #expect(focusRequest.method == SupatermSocketMethod.terminalFocusPane)
    #expect(
      try focusRequest.decodeParams(SupatermPaneTargetRequest.self)
        == SupatermPaneTargetRequest(paneID: paneID)
    )
    #expect(try focusResponse.decodeResult(SupatermFocusPaneResult.self).target == paneTarget)
    #expect(setPaneSizeRequest.method == SupatermSocketMethod.terminalSetPaneSize)
    #expect(
      try setPaneSizeRequest.decodeParams(SupatermSetPaneSizeRequest.self)
        == SupatermSetPaneSizeRequest(
          amount: 30,
          axis: .horizontal,
          target: SupatermPaneTargetRequest(paneID: paneID),
          unit: .percent
        )
    )
  }

  @Test
  func sendTextModesRoundTripThroughTypedHelper() throws {
    let target = SupatermPaneTargetRequest(
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )
    let payloads = [
      SupatermSendTextRequest(mode: .type, target: target, text: "echo hello\n"),
      SupatermSendTextRequest(mode: .submit, target: target, text: "first\nsecond"),
    ]

    for payload in payloads {
      let request = try SupatermSocketRequest.sendText(payload, id: payload.mode.rawValue)

      #expect(request.method == SupatermSocketMethod.terminalSendText)
      #expect(try request.decodeParams(SupatermSendTextRequest.self) == payload)
    }
  }

  @Test
  func paneHealthRequestRoundTripsThroughTypedHelper() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let paneTarget = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: paneID
    )
    let request = try SupatermSocketRequest.paneHealth(
      SupatermPaneHealthRequest(
        target: SupatermPaneTargetRequest(paneID: paneID)
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
          target: SupatermPaneTargetRequest(paneID: paneID)
        )
    )
    #expect(try response.decodeResult(SupatermPaneHealthResult.self).target == paneTarget)
    #expect(try response.decodeResult(SupatermPaneHealthResult.self).isReady)
  }

  @Test
  func spaceAndLayoutRequestsRoundTripThroughTypedHelpers() throws {
    let equalizeTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let tileTabID = UUID(uuidString: "EB0608F9-75AF-41C4-BE62-8070DC604550")!
    let mainVerticalTabID = UUID(uuidString: "FBAE38E2-56FA-424C-91B0-4DE814DE39D2")!
    let createSpaceRequest = try SupatermSocketRequest.createSpace(
      SupatermCreateSpaceRequest(color: nil, name: "Build"),
      id: "create-space-1"
    )
    let equalizeRequest = try SupatermSocketRequest.equalizePanes(
      SupatermTabTargetRequest(tabID: equalizeTabID),
      id: "equalize-panes-1"
    )
    let tileRequest = try SupatermSocketRequest.tilePanes(
      SupatermTabTargetRequest(tabID: tileTabID),
      id: "tile-panes-1"
    )
    let mainVerticalRequest = try SupatermSocketRequest.mainVerticalPanes(
      SupatermTabTargetRequest(tabID: mainVerticalTabID),
      id: "main-vertical-panes-1"
    )

    #expect(createSpaceRequest.method == SupatermSocketMethod.terminalCreateSpace)
    #expect(
      try createSpaceRequest.decodeParams(SupatermCreateSpaceRequest.self)
        == SupatermCreateSpaceRequest(color: nil, name: "Build")
    )
    #expect(equalizeRequest.method == SupatermSocketMethod.terminalEqualizePanes)
    #expect(
      try equalizeRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(tabID: equalizeTabID)
    )
    #expect(tileRequest.method == SupatermSocketMethod.terminalTilePanes)
    #expect(
      try tileRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(tabID: tileTabID)
    )
    #expect(mainVerticalRequest.method == SupatermSocketMethod.terminalMainVerticalPanes)
    #expect(
      try mainVerticalRequest.decodeParams(SupatermTabTargetRequest.self)
        == SupatermTabTargetRequest(tabID: mainVerticalTabID)
    )
  }

  @Test
  func sendKeyRequestRoundTripsThroughTypedHelper() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let request = try SupatermSocketRequest.sendKey(
      SupatermSendKeyRequest(
        key: .enter,
        target: SupatermPaneTargetRequest(paneID: paneID)
      ),
      id: "send-key-1"
    )

    #expect(request.method == SupatermSocketMethod.terminalSendKey)
    #expect(
      try request.decodeParams(SupatermSendKeyRequest.self)
        == SupatermSendKeyRequest(
          key: .enter,
          target: SupatermPaneTargetRequest(paneID: paneID)
        )
    )
  }
}
