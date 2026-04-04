import ComposableArchitecture
import SupatermCLIShared

struct TerminalWindowsClient: Sendable {
  var agentHook: @MainActor @Sendable (SupatermAgentHookRequest) async throws -> TerminalAgentHookResult
  var capturePane: @MainActor @Sendable (TerminalCapturePaneRequest) async throws -> SupatermCapturePaneResult
  var closeWindow: @MainActor @Sendable (ObjectIdentifier) async -> Void
  var closeWindows: @MainActor @Sendable ([ObjectIdentifier]) async -> Void
  var closePane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermClosePaneResult
  var closeSpace: @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermCloseSpaceResult
  var closeTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermCloseTabResult
  var createSpace: @MainActor @Sendable (TerminalCreateSpaceRequest) async throws -> SupatermCreateSpaceResult
  var createTab: @MainActor @Sendable (TerminalCreateTabRequest) async throws -> SupatermNewTabResult
  var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  var equalizePanes: @MainActor @Sendable (TerminalEqualizePanesRequest) async throws -> SupatermEqualizePanesResult
  var mainVerticalPanes:
    @MainActor @Sendable (TerminalMainVerticalPanesRequest) async throws -> SupatermMainVerticalPanesResult
  var notify: @MainActor @Sendable (TerminalNotifyRequest) async throws -> SupatermNotifyResult
  var focusPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  var lastPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  var lastSpace: @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var lastTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var nextSpace: @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var nextTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var onboardingSnapshot: @MainActor @Sendable () async -> SupatermOnboardingSnapshot?
  var previousSpace: @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  var previousTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  var debugSnapshot: @MainActor @Sendable (SupatermDebugRequest) async -> SupatermAppDebugSnapshot
  var renameSpace: @MainActor @Sendable (TerminalRenameSpaceRequest) async throws -> SupatermSpaceTarget
  var renameTab: @MainActor @Sendable (TerminalRenameTabRequest) async throws -> SupatermRenameTabResult
  var resizePane: @MainActor @Sendable (TerminalResizePaneRequest) async throws -> SupatermResizePaneResult
  var setPaneSize: @MainActor @Sendable (TerminalSetPaneSizeRequest) async throws -> SupatermSetPaneSizeResult
  var selectSpace: @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermSelectSpaceResult
  var selectTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermSelectTabResult
  var sendKey: @MainActor @Sendable (TerminalSendKeyRequest) async throws -> SupatermSendKeyResult
  var sendText: @MainActor @Sendable (TerminalSendTextRequest) async throws -> SupatermSendTextResult
  var tilePanes: @MainActor @Sendable (TerminalTilePanesRequest) async throws -> SupatermTilePanesResult
  var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot

  static func live(registry: TerminalWindowRegistry) -> Self {
    Self(
      agentHook: { try registry.handleAgentHook($0) },
      capturePane: { try registry.capturePane($0) },
      closeWindow: { registry.closeWindow($0) },
      closeWindows: { registry.closeWindows($0) },
      closePane: { try registry.closePane($0) },
      closeSpace: { try registry.closeSpace($0) },
      closeTab: { try registry.closeTab($0) },
      createSpace: { try registry.createSpace($0) },
      createTab: { try registry.createTab($0) },
      createPane: { try registry.createPane($0) },
      equalizePanes: { try registry.equalizePanes($0) },
      mainVerticalPanes: { try registry.mainVerticalPanes($0) },
      notify: { try registry.notify($0) },
      focusPane: { try registry.focusPane($0) },
      lastPane: { try registry.lastPane($0) },
      lastSpace: { try registry.lastSpace($0) },
      lastTab: { try registry.lastTab($0) },
      nextSpace: { try registry.nextSpace($0) },
      nextTab: { try registry.nextTab($0) },
      onboardingSnapshot: { registry.onboardingSnapshot() },
      previousSpace: { try registry.previousSpace($0) },
      previousTab: { try registry.previousTab($0) },
      debugSnapshot: { registry.debugSnapshot($0) },
      renameSpace: { try registry.renameSpace($0) },
      renameTab: { try registry.renameTab($0) },
      resizePane: { try registry.resizePane($0) },
      setPaneSize: { try registry.setPaneSize($0) },
      selectSpace: { try registry.selectSpace($0) },
      selectTab: { try registry.selectTab($0) },
      sendKey: { try registry.sendKey($0) },
      sendText: { try registry.sendText($0) },
      tilePanes: { try registry.tilePanes($0) },
      treeSnapshot: { registry.treeSnapshot() }
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
    mainVerticalPanes: { _ in
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
    setPaneSize: { _ in
      throw TerminalControlError.resizeFailed
    },
    selectSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    selectTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    sendKey: { _ in
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
    mainVerticalPanes: { _ in
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
    setPaneSize: { _ in
      throw TerminalControlError.resizeFailed
    },
    selectSpace: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    selectTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
    sendKey: { _ in
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
