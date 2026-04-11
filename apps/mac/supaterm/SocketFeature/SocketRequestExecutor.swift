import ComposableArchitecture
import SupatermCLIShared
import SupatermTerminalCore

public struct SocketRequestExecutor: Sendable {
  public enum AppRequest: Sendable {
    case onboardingSnapshot
    case debugSnapshot(SupatermDebugRequest)
    case treeSnapshot
    case notify(TerminalNotifyRequest)
    case agentHook(SupatermAgentHookRequest)
  }

  public enum AppResult: Sendable {
    case onboardingSnapshot(SupatermOnboardingSnapshot?)
    case debugSnapshot(SupatermAppDebugSnapshot)
    case treeSnapshot(SupatermTreeSnapshot)
    case notify(SupatermNotifyResult)
    case agentHook(TerminalAgentHookResult)
  }

  public enum TerminalCreationRequest: Sendable {
    case createTab(TerminalCreateTabRequest)
    case createPane(TerminalCreatePaneRequest)
  }

  public enum TerminalCreationResult: Sendable {
    case createTab(SupatermNewTabResult)
    case createPane(SupatermNewPaneResult)
  }

  public enum TerminalPaneRequest: Sendable {
    case focusPane(TerminalPaneTarget)
    case lastPane(TerminalPaneTarget)
    case closePane(TerminalPaneTarget)
    case sendText(TerminalSendTextRequest)
    case sendKey(TerminalSendKeyRequest)
    case capturePane(TerminalCapturePaneRequest)
    case resizePane(TerminalResizePaneRequest)
    case setPaneSize(TerminalSetPaneSizeRequest)
  }

  public enum TerminalPaneResult: Sendable {
    case focusPane(SupatermFocusPaneResult)
    case lastPane(SupatermFocusPaneResult)
    case closePane(SupatermClosePaneResult)
    case sendText(SupatermSendTextResult)
    case sendKey(SupatermSendKeyResult)
    case capturePane(SupatermCapturePaneResult)
    case resizePane(SupatermResizePaneResult)
    case setPaneSize(SupatermSetPaneSizeResult)
  }

  public enum TerminalTabRequest: Sendable {
    case tilePanes(TerminalTilePanesRequest)
    case equalizePanes(TerminalEqualizePanesRequest)
    case mainVerticalPanes(TerminalMainVerticalPanesRequest)
    case selectTab(TerminalTabTarget)
    case closeTab(TerminalTabTarget)
    case renameTab(TerminalRenameTabRequest)
    case nextTab(TerminalTabNavigationRequest)
    case previousTab(TerminalTabNavigationRequest)
    case lastTab(TerminalTabNavigationRequest)
  }

  public enum TerminalTabResult: Sendable {
    case tilePanes(SupatermTilePanesResult)
    case equalizePanes(SupatermEqualizePanesResult)
    case mainVerticalPanes(SupatermMainVerticalPanesResult)
    case selectTab(SupatermSelectTabResult)
    case closeTab(SupatermCloseTabResult)
    case renameTab(SupatermRenameTabResult)
    case nextTab(SupatermSelectTabResult)
    case previousTab(SupatermSelectTabResult)
    case lastTab(SupatermSelectTabResult)
  }

  public enum TerminalSpaceRequest: Sendable {
    case createSpace(TerminalCreateSpaceRequest)
    case selectSpace(TerminalSpaceTarget)
    case closeSpace(TerminalSpaceTarget)
    case renameSpace(TerminalRenameSpaceRequest)
    case nextSpace(TerminalSpaceNavigationRequest)
    case previousSpace(TerminalSpaceNavigationRequest)
    case lastSpace(TerminalSpaceNavigationRequest)
  }

  public enum TerminalSpaceResult: Sendable {
    case createSpace(SupatermCreateSpaceResult)
    case selectSpace(SupatermSelectSpaceResult)
    case closeSpace(SupatermCloseSpaceResult)
    case renameSpace(SupatermSpaceTarget)
    case nextSpace(SupatermSelectSpaceResult)
    case previousSpace(SupatermSelectSpaceResult)
    case lastSpace(SupatermSelectSpaceResult)
  }

  public var executeApp: @MainActor @Sendable (AppRequest) async throws -> AppResult
  public var executeTerminalCreation:
    @MainActor @Sendable (TerminalCreationRequest) async throws -> TerminalCreationResult
  public var executeTerminalPane: @MainActor @Sendable (TerminalPaneRequest) async throws -> TerminalPaneResult
  public var executeTerminalTab: @MainActor @Sendable (TerminalTabRequest) async throws -> TerminalTabResult
  public var executeTerminalSpace: @MainActor @Sendable (TerminalSpaceRequest) async throws -> TerminalSpaceResult

  public init(
    executeApp: @escaping @MainActor @Sendable (AppRequest) async throws -> AppResult,
    executeTerminalCreation:
      @escaping @MainActor @Sendable (
        TerminalCreationRequest
      ) async throws -> TerminalCreationResult,
    executeTerminalPane:
      @escaping @MainActor @Sendable (
        TerminalPaneRequest
      ) async throws -> TerminalPaneResult,
    executeTerminalTab:
      @escaping @MainActor @Sendable (
        TerminalTabRequest
      ) async throws -> TerminalTabResult,
    executeTerminalSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceRequest
      ) async throws -> TerminalSpaceResult
  ) {
    self.executeApp = executeApp
    self.executeTerminalCreation = executeTerminalCreation
    self.executeTerminalPane = executeTerminalPane
    self.executeTerminalTab = executeTerminalTab
    self.executeTerminalSpace = executeTerminalSpace
  }
}

extension SocketRequestExecutor: DependencyKey {
  public static let liveValue = Self(
    executeApp: { request in
      switch request {
      case .onboardingSnapshot:
        return .onboardingSnapshot(nil)
      case .debugSnapshot:
        return .debugSnapshot(Self.emptyDebugSnapshot)
      case .treeSnapshot:
        return .treeSnapshot(.init(windows: []))
      case .notify:
        throw TerminalCreatePaneError.creationFailed
      case .agentHook:
        return .agentHook(.init(desktopNotification: nil))
      }
    },
    executeTerminalCreation: { request in
      switch request {
      case .createTab:
        throw TerminalCreateTabError.creationFailed
      case .createPane:
        throw TerminalCreatePaneError.creationFailed
      }
    },
    executeTerminalPane: { request in
      switch request {
      case .focusPane:
        throw TerminalControlError.contextPaneNotFound
      case .lastPane:
        throw TerminalControlError.lastPaneNotFound
      case .closePane:
        throw TerminalControlError.contextPaneNotFound
      case .sendText:
        throw TerminalControlError.contextPaneNotFound
      case .sendKey:
        throw TerminalControlError.contextPaneNotFound
      case .capturePane:
        throw TerminalControlError.captureFailed
      case .resizePane:
        throw TerminalControlError.resizeFailed
      case .setPaneSize:
        throw TerminalControlError.resizeFailed
      }
    },
    executeTerminalTab: { request in
      switch request {
      case .tilePanes:
        throw TerminalControlError.contextPaneNotFound
      case .equalizePanes:
        throw TerminalControlError.contextPaneNotFound
      case .mainVerticalPanes:
        throw TerminalControlError.contextPaneNotFound
      case .selectTab:
        throw TerminalControlError.contextPaneNotFound
      case .closeTab:
        throw TerminalControlError.contextPaneNotFound
      case .renameTab:
        throw TerminalControlError.contextPaneNotFound
      case .nextTab:
        throw TerminalControlError.lastTabNotFound
      case .previousTab:
        throw TerminalControlError.lastTabNotFound
      case .lastTab:
        throw TerminalControlError.lastTabNotFound
      }
    },
    executeTerminalSpace: { request in
      switch request {
      case .createSpace:
        throw TerminalControlError.contextPaneNotFound
      case .selectSpace:
        throw TerminalControlError.contextPaneNotFound
      case .closeSpace:
        throw TerminalControlError.contextPaneNotFound
      case .renameSpace:
        throw TerminalControlError.contextPaneNotFound
      case .nextSpace:
        throw TerminalControlError.lastSpaceNotFound
      case .previousSpace:
        throw TerminalControlError.lastSpaceNotFound
      case .lastSpace:
        throw TerminalControlError.lastSpaceNotFound
      }
    }
  )

  public static let testValue = liveValue

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
  public var socketRequestExecutor: SocketRequestExecutor {
    get { self[SocketRequestExecutor.self] }
    set { self[SocketRequestExecutor.self] = newValue }
  }
}
