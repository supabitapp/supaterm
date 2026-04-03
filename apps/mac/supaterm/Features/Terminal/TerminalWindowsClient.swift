import ComposableArchitecture
import SupatermCLIShared

struct TerminalWindowsClient: Sendable {
  var agentHook:
    @MainActor @Sendable (SupatermAgentHookRequest) async throws -> TerminalAgentHookResult
  var capturePane:
    @MainActor @Sendable (TerminalCapturePaneRequest) async throws -> SupatermCapturePaneResult
  var closeWindow: @MainActor @Sendable (ObjectIdentifier) async -> Void
  var closeWindows: @MainActor @Sendable ([ObjectIdentifier]) async -> Void
  var closePane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermClosePaneResult
  var closeSpace:
    @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermCloseSpaceResult
  var closeTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermCloseTabResult
  var createSpace:
    @MainActor @Sendable (TerminalCreateSpaceRequest) async throws -> SupatermCreateSpaceResult
  var createTab:
    @MainActor @Sendable (TerminalCreateTabRequest) async throws -> SupatermNewTabResult
  var createPane:
    @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var equalizePanes:
    @MainActor @Sendable (TerminalEqualizePanesRequest) async throws -> SupatermEqualizePanesResult
  var notify: @MainActor @Sendable (TerminalNotifyRequest) async throws -> SupatermNotifyResult
  var focusPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  var lastPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  var lastSpace:
    @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var lastTab:
    @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var nextSpace:
    @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var nextTab:
    @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var onboardingSnapshot: @MainActor @Sendable () async -> SupatermOnboardingSnapshot?
  var previousSpace:
    @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var previousTab:
    @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var debugSnapshot: @MainActor @Sendable (SupatermDebugRequest) async -> SupatermAppDebugSnapshot
  var renameSpace:
    @MainActor @Sendable (TerminalRenameSpaceRequest) async throws -> SupatermSpaceTarget
  var renameTab:
    @MainActor @Sendable (TerminalRenameTabRequest) async throws -> SupatermRenameTabResult
  var resizePane:
    @MainActor @Sendable (TerminalResizePaneRequest) async throws -> SupatermResizePaneResult
  var selectSpace:
    @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermSelectSpaceResult
  var selectTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermSelectTabResult
  var sendText:
    @MainActor @Sendable (TerminalSendTextRequest) async throws -> SupatermSendTextResult
  var tilePanes:
    @MainActor @Sendable (TerminalTilePanesRequest) async throws -> SupatermTilePanesResult
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      agentHook: { request in
        try registry.handleAgentHook(request)
      },
      capturePane: { request in
        try registry.capturePane(request)
      },
      closeWindow: { windowID in
        registry.closeWindow(windowID)
      },
      closeWindows: { windowIDs in
        registry.closeWindows(windowIDs)
      },
      closePane: { target in
        try registry.closePane(target)
      },
      closeSpace: { target in
        try registry.closeSpace(target)
      },
      closeTab: { target in
        try registry.closeTab(target)
      },
      createSpace: { request in
        try registry.createSpace(request)
      },
      createTab: { request in
        try registry.createTab(request)
      },
      createPane: { request in
        try registry.createPane(request)
      },
      equalizePanes: { request in
        try registry.equalizePanes(request)
      },
      notify: { request in
        try registry.notify(request)
      },
      focusPane: { target in
        try registry.focusPane(target)
      },
      lastPane: { target in
        try registry.lastPane(target)
      },
      lastSpace: { request in
        try registry.lastSpace(request)
      },
      lastTab: { request in
        try registry.lastTab(request)
      },
      nextSpace: { request in
        try registry.nextSpace(request)
      },
      nextTab: { request in
        try registry.nextTab(request)
      },
      onboardingSnapshot: {
        registry.onboardingSnapshot()
      },
      previousSpace: { request in
        try registry.previousSpace(request)
      },
      previousTab: { request in
        try registry.previousTab(request)
      },
      debugSnapshot: { request in
        registry.debugSnapshot(request)
      },
      renameSpace: { request in
        try registry.renameSpace(request)
      },
      renameTab: { request in
        try registry.renameTab(request)
      },
      resizePane: { request in
        try registry.resizePane(request)
      },
      selectSpace: { target in
        try registry.selectSpace(target)
      },
      selectTab: { target in
        try registry.selectTab(target)
      },
      sendText: { request in
        try registry.sendText(request)
      },
      tilePanes: { request in
        try registry.tilePanes(request)
      },
      treeSnapshot: {
        registry.treeSnapshot()
      }
    )
  }
}

extension TerminalWindowsClient: DependencyKey {
  static let liveValue = Self(
    agentHook: { _ in
      .init(desktopNotification: nil)
    },
    capturePane: { _ in
      throw TerminalControlError.captureFailed
    },
    closeWindow: { _ in },
    closeWindows: { _ in },
    closePane: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    closeSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    closeTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    createSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    createTab: { _ in
      throw TerminalCreateTabError.creationFailed
    },
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    equalizePanes: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    notify: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    focusPane: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    lastPane: { _ in
      throw TerminalControlError.lastPaneNotFound
    },
    lastSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    lastTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    nextSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    nextTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    onboardingSnapshot: { nil },
    previousSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    previousTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    debugSnapshot: { _ in Self.emptyDebugSnapshot },
    renameSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    renameTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    resizePane: { _ in
      throw TerminalControlError.resizeFailed
    },
    selectSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    selectTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    sendText: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    tilePanes: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    treeSnapshot: { .init(windows: []) }
  )

  static let testValue = Self(
    agentHook: { _ in
      .init(desktopNotification: nil)
    },
    capturePane: { _ in
      throw TerminalControlError.captureFailed
    },
    closeWindow: { _ in },
    closeWindows: { _ in },
    closePane: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    closeSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    closeTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    createSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    createTab: { _ in
      throw TerminalCreateTabError.creationFailed
    },
    createPane: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    equalizePanes: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    notify: { _ in
      throw TerminalCreatePaneError.creationFailed
    },
    focusPane: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    lastPane: { _ in
      throw TerminalControlError.lastPaneNotFound
    },
    lastSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    lastTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    nextSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    nextTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    onboardingSnapshot: { nil },
    previousSpace: { _ in
      throw TerminalControlError.lastSpaceNotFound
    },
    previousTab: { _ in
      throw TerminalControlError.lastTabNotFound
    },
    debugSnapshot: { _ in Self.emptyDebugSnapshot },
    renameSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    renameTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    resizePane: { _ in
      throw TerminalControlError.resizeFailed
    },
    selectSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    selectTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    sendText: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    tilePanes: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    treeSnapshot: { .init(windows: []) }
  )

  private static let emptyDebugSnapshot = SupatermAppDebugSnapshot(
    build: .init(
      version: "",
      buildNumber: "",
      isDevelopmentBuild: false,
      usesStubUpdateChecks: false
    ),
    update: .init(
      canCheckForUpdates: false,
      phase: "idle",
      detail: ""
    ),
    summary: .init(
      windowCount: 0,
      spaceCount: 0,
      tabCount: 0,
      paneCount: 0,
      keyWindowIndex: nil
    ),
    currentTarget: nil,
    windows: [],
    problems: ["No active windows."]
  )
}

extension DependencyValues {
  var terminalWindowsClient: TerminalWindowsClient {
    get { self[TerminalWindowsClient.self] }
    set { self[TerminalWindowsClient.self] = newValue }
  }
}
