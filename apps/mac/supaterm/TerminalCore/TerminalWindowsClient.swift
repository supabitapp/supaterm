import ComposableArchitecture
import Foundation
import SupatermCLIShared

public struct TerminalWindowsClient: Sendable {
  public var agentHook: @MainActor @Sendable (SupatermAgentHookRequest) async throws -> TerminalAgentHookResult
  public var capturePane: @MainActor @Sendable (TerminalCapturePaneRequest) async throws -> SupatermCapturePaneResult
  public var screenshotPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermScreenshotPaneResult
  public var closePane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermClosePaneResult
  public var closeSpace: @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermCloseSpaceResult
  public var closeTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermCloseTabResult
  public var createSpace: @MainActor @Sendable (TerminalCreateSpaceRequest) async throws -> SupatermCreateSpaceResult
  public var createTab: @MainActor @Sendable (TerminalCreateTabRequest) async throws -> SupatermNewTabResult
  public var createPane: @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult
  public var equalizePanes:
    @MainActor @Sendable (TerminalEqualizePanesRequest) async throws -> SupatermEqualizePanesResult
  public var mainVerticalPanes:
    @MainActor @Sendable (TerminalMainVerticalPanesRequest) async throws -> SupatermMainVerticalPanesResult
  public var notify: @MainActor @Sendable (TerminalNotifyRequest) async throws -> SupatermNotifyResult
  public var pinTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermPinTabResult
  public var focusPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  public var lastPane: @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult
  public var paneHealth: @MainActor @Sendable (TerminalPaneHealthRequest) async throws -> SupatermPaneHealthResult
  public var lastSpace: @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  public var lastTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  public var nextSpace: @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  public var nextTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  public var onboardingSnapshot: @MainActor @Sendable () async -> SupatermOnboardingSnapshot?
  public var previousSpace:
    @MainActor @Sendable (TerminalSpaceNavigationRequest) async throws -> SupatermSelectSpaceResult
  public var previousTab: @MainActor @Sendable (TerminalTabNavigationRequest) async throws -> SupatermSelectTabResult
  public var debugSnapshot: @MainActor @Sendable (SupatermDebugRequest) async -> SupatermAppDebugSnapshot
  public var renameSpace: @MainActor @Sendable (TerminalRenameSpaceRequest) async throws -> SupatermSpaceTarget
  public var renameTab: @MainActor @Sendable (TerminalRenameTabRequest) async throws -> SupatermRenameTabResult
  public var resizePane: @MainActor @Sendable (TerminalResizePaneRequest) async throws -> SupatermResizePaneResult
  public var setPaneSize: @MainActor @Sendable (TerminalSetPaneSizeRequest) async throws -> SupatermSetPaneSizeResult
  public var setSpaceColor: @MainActor @Sendable (TerminalSetSpaceColorRequest) async throws -> SupatermSpaceTarget
  public var selectSpace: @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermSelectSpaceResult
  public var selectTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermSelectTabResult
  public var sendKey: @MainActor @Sendable (TerminalSendKeyRequest) async throws -> SupatermSendKeyResult
  public var sendText: @MainActor @Sendable (TerminalSendTextRequest) async throws -> SupatermSendTextResult
  public var tilePanes: @MainActor @Sendable (TerminalTilePanesRequest) async throws -> SupatermTilePanesResult
  public var treeSnapshot: @MainActor @Sendable () async -> SupatermTreeSnapshot
  public var unpinTab: @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermPinTabResult

  public init(
    agentHook: @escaping @MainActor @Sendable (SupatermAgentHookRequest) async throws -> TerminalAgentHookResult,
    capturePane: @escaping @MainActor @Sendable (TerminalCapturePaneRequest) async throws -> SupatermCapturePaneResult,
    screenshotPane:
      @escaping @MainActor @Sendable (
        TerminalPaneTarget
      ) async throws -> SupatermScreenshotPaneResult,
    closePane: @escaping @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermClosePaneResult,
    closeSpace: @escaping @MainActor @Sendable (TerminalSpaceTarget) async throws -> SupatermCloseSpaceResult,
    closeTab: @escaping @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermCloseTabResult,
    createSpace: @escaping @MainActor @Sendable (TerminalCreateSpaceRequest) async throws -> SupatermCreateSpaceResult,
    createTab: @escaping @MainActor @Sendable (TerminalCreateTabRequest) async throws -> SupatermNewTabResult,
    createPane: @escaping @MainActor @Sendable (TerminalCreatePaneRequest) async throws -> SupatermNewPaneResult,
    equalizePanes:
      @escaping @MainActor @Sendable (
        TerminalEqualizePanesRequest
      ) async throws -> SupatermEqualizePanesResult,
    mainVerticalPanes:
      @escaping @MainActor @Sendable (
        TerminalMainVerticalPanesRequest
      ) async throws -> SupatermMainVerticalPanesResult,
    notify: @escaping @MainActor @Sendable (TerminalNotifyRequest) async throws -> SupatermNotifyResult,
    focusPane: @escaping @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult,
    lastPane: @escaping @MainActor @Sendable (TerminalPaneTarget) async throws -> SupatermFocusPaneResult,
    paneHealth:
      @escaping @MainActor @Sendable (
        TerminalPaneHealthRequest
      ) async throws -> SupatermPaneHealthResult,
    lastSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceNavigationRequest
      ) async throws -> SupatermSelectSpaceResult,
    lastTab:
      @escaping @MainActor @Sendable (
        TerminalTabNavigationRequest
      ) async throws -> SupatermSelectTabResult,
    nextSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceNavigationRequest
      ) async throws -> SupatermSelectSpaceResult,
    nextTab:
      @escaping @MainActor @Sendable (
        TerminalTabNavigationRequest
      ) async throws -> SupatermSelectTabResult,
    onboardingSnapshot: @escaping @MainActor @Sendable () async -> SupatermOnboardingSnapshot?,
    pinTab: @escaping @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermPinTabResult,
    previousSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceNavigationRequest
      ) async throws -> SupatermSelectSpaceResult,
    previousTab:
      @escaping @MainActor @Sendable (
        TerminalTabNavigationRequest
      ) async throws -> SupatermSelectTabResult,
    debugSnapshot:
      @escaping @MainActor @Sendable (
        SupatermDebugRequest
      ) async -> SupatermAppDebugSnapshot,
    renameSpace:
      @escaping @MainActor @Sendable (
        TerminalRenameSpaceRequest
      ) async throws -> SupatermSpaceTarget,
    renameTab:
      @escaping @MainActor @Sendable (
        TerminalRenameTabRequest
      ) async throws -> SupatermRenameTabResult,
    resizePane:
      @escaping @MainActor @Sendable (
        TerminalResizePaneRequest
      ) async throws -> SupatermResizePaneResult,
    setSpaceColor:
      @escaping @MainActor @Sendable (
        TerminalSetSpaceColorRequest
      ) async throws -> SupatermSpaceTarget,
    setPaneSize:
      @escaping @MainActor @Sendable (
        TerminalSetPaneSizeRequest
      ) async throws -> SupatermSetPaneSizeResult,
    selectSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceTarget
      ) async throws -> SupatermSelectSpaceResult,
    selectTab:
      @escaping @MainActor @Sendable (
        TerminalTabTarget
      ) async throws -> SupatermSelectTabResult,
    sendKey:
      @escaping @MainActor @Sendable (
        TerminalSendKeyRequest
      ) async throws -> SupatermSendKeyResult,
    sendText:
      @escaping @MainActor @Sendable (
        TerminalSendTextRequest
      ) async throws -> SupatermSendTextResult,
    tilePanes:
      @escaping @MainActor @Sendable (
        TerminalTilePanesRequest
      ) async throws -> SupatermTilePanesResult,
    treeSnapshot: @escaping @MainActor @Sendable () async -> SupatermTreeSnapshot,
    unpinTab: @escaping @MainActor @Sendable (TerminalTabTarget) async throws -> SupatermPinTabResult
  ) {
    self.agentHook = agentHook
    self.capturePane = capturePane
    self.screenshotPane = screenshotPane
    self.closePane = closePane
    self.closeSpace = closeSpace
    self.closeTab = closeTab
    self.createSpace = createSpace
    self.createTab = createTab
    self.createPane = createPane
    self.equalizePanes = equalizePanes
    self.mainVerticalPanes = mainVerticalPanes
    self.notify = notify
    self.pinTab = pinTab
    self.focusPane = focusPane
    self.lastPane = lastPane
    self.paneHealth = paneHealth
    self.lastSpace = lastSpace
    self.lastTab = lastTab
    self.nextSpace = nextSpace
    self.nextTab = nextTab
    self.onboardingSnapshot = onboardingSnapshot
    self.previousSpace = previousSpace
    self.previousTab = previousTab
    self.debugSnapshot = debugSnapshot
    self.renameSpace = renameSpace
    self.renameTab = renameTab
    self.resizePane = resizePane
    self.setPaneSize = setPaneSize
    self.setSpaceColor = setSpaceColor
    self.selectSpace = selectSpace
    self.selectTab = selectTab
    self.sendKey = sendKey
    self.sendText = sendText
    self.tilePanes = tilePanes
    self.treeSnapshot = treeSnapshot
    self.unpinTab = unpinTab
  }
}

extension TerminalWindowsClient: DependencyKey {
  public static let liveValue = Self(
    agentHook: { _ in
      TerminalAgentHookResult(desktopNotification: nil)
    },
    capturePane: { _ in
      throw TerminalControlError.captureFailed
    },
    screenshotPane: { _ in
      throw TerminalControlError.screenshotFailed
    },
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
    paneHealth: { _ in
      throw TerminalControlError.contextPaneNotFound
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
    pinTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    },
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
    setSpaceColor: { _ in
      throw TerminalControlError.contextPaneNotFound
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
    treeSnapshot: { SupatermTreeSnapshot(windows: []) },
    unpinTab: { _ in
      throw TerminalControlError.contextPaneNotFound
    }
  )

  public static let testValue = Self(
    agentHook: unimplemented("TerminalWindowsClient.agentHook"),
    capturePane: unimplemented("TerminalWindowsClient.capturePane"),
    screenshotPane: unimplemented("TerminalWindowsClient.screenshotPane"),
    closePane: unimplemented("TerminalWindowsClient.closePane"),
    closeSpace: unimplemented("TerminalWindowsClient.closeSpace"),
    closeTab: unimplemented("TerminalWindowsClient.closeTab"),
    createSpace: unimplemented("TerminalWindowsClient.createSpace"),
    createTab: unimplemented("TerminalWindowsClient.createTab"),
    createPane: unimplemented("TerminalWindowsClient.createPane"),
    equalizePanes: unimplemented("TerminalWindowsClient.equalizePanes"),
    mainVerticalPanes: unimplemented("TerminalWindowsClient.mainVerticalPanes"),
    notify: unimplemented("TerminalWindowsClient.notify"),
    focusPane: unimplemented("TerminalWindowsClient.focusPane"),
    lastPane: unimplemented("TerminalWindowsClient.lastPane"),
    paneHealth: unimplemented("TerminalWindowsClient.paneHealth"),
    lastSpace: unimplemented("TerminalWindowsClient.lastSpace"),
    lastTab: unimplemented("TerminalWindowsClient.lastTab"),
    nextSpace: unimplemented("TerminalWindowsClient.nextSpace"),
    nextTab: unimplemented("TerminalWindowsClient.nextTab"),
    onboardingSnapshot: unimplemented(
      "TerminalWindowsClient.onboardingSnapshot",
      placeholder: nil
    ),
    pinTab: unimplemented("TerminalWindowsClient.pinTab"),
    previousSpace: unimplemented("TerminalWindowsClient.previousSpace"),
    previousTab: unimplemented("TerminalWindowsClient.previousTab"),
    debugSnapshot: unimplemented(
      "TerminalWindowsClient.debugSnapshot",
      placeholder: Self.emptyDebugSnapshot
    ),
    renameSpace: unimplemented("TerminalWindowsClient.renameSpace"),
    renameTab: unimplemented("TerminalWindowsClient.renameTab"),
    resizePane: unimplemented("TerminalWindowsClient.resizePane"),
    setSpaceColor: unimplemented("TerminalWindowsClient.setSpaceColor"),
    setPaneSize: unimplemented("TerminalWindowsClient.setPaneSize"),
    selectSpace: unimplemented("TerminalWindowsClient.selectSpace"),
    selectTab: unimplemented("TerminalWindowsClient.selectTab"),
    sendKey: unimplemented("TerminalWindowsClient.sendKey"),
    sendText: unimplemented("TerminalWindowsClient.sendText"),
    tilePanes: unimplemented("TerminalWindowsClient.tilePanes"),
    treeSnapshot: unimplemented(
      "TerminalWindowsClient.treeSnapshot",
      placeholder: SupatermTreeSnapshot(windows: [])
    ),
    unpinTab: unimplemented("TerminalWindowsClient.unpinTab")
  )

  private nonisolated static let emptyDebugSnapshot = SupatermAppDebugSnapshot(
    build: SupatermAppDebugSnapshot.Build(
      version: "",
      buildNumber: "",
      isDevelopmentBuild: false,
      usesStubUpdateChecks: false
    ),
    update: SupatermAppDebugSnapshot.Update(
      canCheckForUpdates: false,
      phase: "idle",
      detail: ""
    ),
    summary: SupatermAppDebugSnapshot.Summary(
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
  public var terminalWindowsClient: TerminalWindowsClient {
    get { self[TerminalWindowsClient.self] }
    set { self[TerminalWindowsClient.self] = newValue }
  }
}
