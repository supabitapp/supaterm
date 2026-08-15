import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

public struct SocketRequestExecutor: Sendable {
  public enum AppRequest: Sendable {
    case onboardingSnapshot
    case debugSnapshot(SupatermDebugRequest)
    case settingsGet(SupatermSettingsGetRequest)
    case settingsList(SupatermSettingsListRequest)
    case settingsReset(SupatermSettingsResetRequest)
    case settingsSet(SupatermSettingsSetRequest)
    case settingsValidate(SupatermSettingsValidateRequest)
    case treeSnapshot
    case notify(TerminalNotifyRequest)
    case agentHook(SupatermAgentHookRequest)
    case quit
  }

  public enum AppResult: Sendable {
    case onboardingSnapshot(SupatermOnboardingSnapshot?)
    case debugSnapshot(SupatermAppDebugSnapshot)
    case settingsGet(SupatermSettingsGetResult)
    case settingsList(SupatermSettingsListResult)
    case settingsReset(SupatermSettingsMutationResult)
    case settingsSet(SupatermSettingsMutationResult)
    case settingsValidate(SupatermSettingsValidationResult)
    case treeSnapshot(SupatermTreeSnapshot)
    case notify(SupatermNotifyResult)
    case agentHook(TerminalAgentHookResult)
    case quit
  }

  public enum AgentIntegrationRequest: Sendable {
    case hooksInstall(SupatermAgentHookTargetRequest)
    case hooksRemove(SupatermAgentHookTargetRequest)
    case skillsGet(SupatermSkillGetRequest)
    case skillsInstall
    case skillsList
    case skillsPath(SupatermSkillPathRequest)
  }

  public enum AgentIntegrationResult: Sendable {
    case hooksInstall(SupatermAgentHookHealth)
    case hooksRemove(SupatermAgentHookHealth)
    case skillsGet(SupatermSkillContent)
    case skillsInstall(SupatermSkillInstallResult)
    case skillsList(SupatermSkillListResult)
    case skillsPath(SupatermSkillPathResult)
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
    case agentExplain(TerminalPaneTarget)
    case focusPane(TerminalPaneTarget)
    case lastPane(TerminalPaneTarget)
    case closePane(TerminalPaneTarget)
    case sendText(TerminalSendTextRequest)
    case sendKey(TerminalSendKeyRequest)
    case capturePane(TerminalCapturePaneRequest)
    case screenshotPane(TerminalPaneTarget)
    case paneHealth(TerminalPaneHealthRequest)
    case resizePane(TerminalResizePaneRequest)
    case setPaneSize(TerminalSetPaneSizeRequest)
  }

  public enum TerminalPaneResult: Sendable {
    case agentExplain(SupatermAgentExplainResult)
    case focusPane(SupatermFocusPaneResult)
    case lastPane(SupatermFocusPaneResult)
    case closePane(SupatermClosePaneResult)
    case sendText(SupatermSendTextResult)
    case sendKey(SupatermSendKeyResult)
    case capturePane(SupatermCapturePaneResult)
    case screenshotPane(SupatermScreenshotPaneResult)
    case paneHealth(SupatermPaneHealthResult)
    case resizePane(SupatermResizePaneResult)
    case setPaneSize(SupatermSetPaneSizeResult)
  }

  public enum TerminalTabRequest: Sendable {
    case tilePanes(TerminalTilePanesRequest)
    case equalizePanes(TerminalEqualizePanesRequest)
    case mainVerticalPanes(TerminalMainVerticalPanesRequest)
    case selectTab(TerminalTabTarget)
    case pinTab(TerminalTabTarget)
    case unpinTab(TerminalTabTarget)
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
    case pinTab(SupatermPinTabResult)
    case unpinTab(SupatermPinTabResult)
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
    case setSpaceColor(TerminalSetSpaceColorRequest)
    case nextSpace(TerminalSpaceNavigationRequest)
    case previousSpace(TerminalSpaceNavigationRequest)
    case lastSpace(TerminalSpaceNavigationRequest)
  }

  public enum TerminalSpaceResult: Sendable {
    case createSpace(SupatermCreateSpaceResult)
    case selectSpace(SupatermSelectSpaceResult)
    case closeSpace(SupatermCloseSpaceResult)
    case renameSpace(SupatermSpaceTarget)
    case setSpaceColor(SupatermSpaceTarget)
    case nextSpace(SupatermSelectSpaceResult)
    case previousSpace(SupatermSelectSpaceResult)
    case lastSpace(SupatermSelectSpaceResult)
  }

  public var executeApp: @MainActor @Sendable (AppRequest) async throws -> AppResult
  public var executeAgentIntegration:
    @MainActor @Sendable (AgentIntegrationRequest) async throws -> AgentIntegrationResult
  public var executeTerminalCreation:
    @MainActor @Sendable (TerminalCreationRequest) async throws -> TerminalCreationResult
  public var executeTerminalPane: @MainActor @Sendable (TerminalPaneRequest) async throws -> TerminalPaneResult
  public var executeTerminalTab: @MainActor @Sendable (TerminalTabRequest) async throws -> TerminalTabResult
  public var executeTerminalTabGroup:
    @MainActor @Sendable (TerminalTabGroupRequest) async throws -> TerminalTabGroupResult
  public var executeTerminalSpace: @MainActor @Sendable (TerminalSpaceRequest) async throws -> TerminalSpaceResult

  public init(
    executeApp: @escaping @MainActor @Sendable (AppRequest) async throws -> AppResult,
    executeAgentIntegration:
      @escaping @MainActor @Sendable (
        AgentIntegrationRequest
      ) async throws -> AgentIntegrationResult,
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
    executeTerminalTabGroup:
      @escaping @MainActor @Sendable (
        TerminalTabGroupRequest
      ) async throws -> TerminalTabGroupResult = { _ in
        throw TerminalControlError.contextPaneNotFound
      },
    executeTerminalSpace:
      @escaping @MainActor @Sendable (
        TerminalSpaceRequest
      ) async throws -> TerminalSpaceResult
  ) {
    self.executeApp = executeApp
    self.executeAgentIntegration = executeAgentIntegration
    self.executeTerminalCreation = executeTerminalCreation
    self.executeTerminalPane = executeTerminalPane
    self.executeTerminalTab = executeTerminalTab
    self.executeTerminalTabGroup = executeTerminalTabGroup
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
      case .settingsGet(let request):
        return .settingsGet(
          try SupatermSettingsRegistry.get(
            key: request.key,
            settings: .default,
            path: SupatermStateRoot.settingsFileURL().path
          )
        )
      case .settingsList(let request):
        return .settingsList(
          SupatermSettingsRegistry.list(
            settings: .default,
            path: SupatermStateRoot.settingsFileURL().path,
            changedOnly: request.changedOnly
          )
        )
      case .settingsReset(let request):
        return .settingsReset(
          try SupatermSettingsRegistry.reset(
            request,
            settings: .default,
            path: SupatermStateRoot.settingsFileURL().path
          ).result
        )
      case .settingsSet(let request):
        return .settingsSet(
          try SupatermSettingsRegistry.set(
            request,
            settings: .default,
            path: SupatermStateRoot.settingsFileURL().path
          ).result
        )
      case .settingsValidate(let request):
        return .settingsValidate(
          SupatermSettingsValidator().validate(
            path: request.path.map { URL(fileURLWithPath: $0, isDirectory: false) }
          )
        )
      case .treeSnapshot:
        return .treeSnapshot(SupatermTreeSnapshot(windows: []))
      case .notify:
        throw TerminalCreatePaneError.creationFailed
      case .agentHook:
        return .agentHook(TerminalAgentHookResult(desktopNotification: nil))
      case .quit:
        return .quit
      }
    },
    executeAgentIntegration: { request in
      switch request {
      case .hooksInstall(let request):
        return .hooksInstall(SupatermAgentHookHealth(agent: request.agent, health: .unavailable))
      case .hooksRemove(let request):
        return .hooksRemove(SupatermAgentHookHealth(agent: request.agent, health: .unavailable))
      case .skillsGet, .skillsInstall, .skillsList, .skillsPath:
        throw SupatermSkillsError.bundledSkillsUnavailable(nil)
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
      case .agentExplain:
        throw TerminalControlError.contextPaneNotFound
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
      case .screenshotPane:
        throw TerminalControlError.screenshotFailed
      case .paneHealth:
        throw TerminalControlError.contextPaneNotFound
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
      case .pinTab:
        throw TerminalControlError.contextPaneNotFound
      case .unpinTab:
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
      case .setSpaceColor:
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

  public static let testValue = Self(
    executeApp: unimplemented("SocketRequestExecutor.executeApp"),
    executeAgentIntegration: unimplemented("SocketRequestExecutor.executeAgentIntegration"),
    executeTerminalCreation: unimplemented("SocketRequestExecutor.executeTerminalCreation"),
    executeTerminalPane: unimplemented("SocketRequestExecutor.executeTerminalPane"),
    executeTerminalTab: unimplemented("SocketRequestExecutor.executeTerminalTab"),
    executeTerminalTabGroup: unimplemented("SocketRequestExecutor.executeTerminalTabGroup"),
    executeTerminalSpace: unimplemented("SocketRequestExecutor.executeTerminalSpace")
  )

  private static let emptyDebugSnapshot = SupatermAppDebugSnapshot(
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
  public var socketRequestExecutor: SocketRequestExecutor {
    get { self[SocketRequestExecutor.self] }
    set { self[SocketRequestExecutor.self] = newValue }
  }
}
