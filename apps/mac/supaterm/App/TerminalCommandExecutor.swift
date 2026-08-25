import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore

@MainActor
final class TerminalCommandExecutor {
  unowned let registry: TerminalWindowRegistry
  let agentDetectionRuleRepository: AgentDetectionRuleRepository?
  let paneCaptureClient: TerminalPaneCaptureClient
  let licenseDeviceName: @MainActor () -> String
  var onQuitRequested: (() -> Void)?

  init(
    registry: TerminalWindowRegistry,
    agentDetectionRuleRepository: AgentDetectionRuleRepository? = nil,
    paneCaptureClient: TerminalPaneCaptureClient = .live,
    licenseDeviceName: @escaping @MainActor () -> String = {
      Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    }
  ) {
    self.registry = registry
    self.agentDetectionRuleRepository = agentDetectionRuleRepository
    self.paneCaptureClient = paneCaptureClient
    self.licenseDeviceName = licenseDeviceName
  }

  func executeTargeted<Result>(
    context: SupatermCLIContext? = nil,
    operation: (TerminalWindowRegistry.Entry) throws -> Result,
    rewrite: (Result, Int) -> Result
  ) throws -> Result {
    for entry in registry.ambientEntries(for: context) {
      do {
        return rewrite(try operation(entry), registry.windowIndex(of: entry))
      } catch TerminalControlError.contextPaneNotFound {
        continue
      }
    }
    throw TerminalControlError.contextPaneNotFound
  }

  func execute(_ request: SocketRequestExecutor.AppRequest) throws -> SocketRequestExecutor.AppResult {
    switch request {
    case .onboardingSnapshot:
      return .onboardingSnapshot(onboardingSnapshot())
    case .debugSnapshot(let debugRequest):
      return .debugSnapshot(debugSnapshot(debugRequest))
    case .settingsGet(let request):
      return .settingsGet(try settingsGet(request))
    case .settingsList(let request):
      return .settingsList(settingsList(request))
    case .settingsReset(let request):
      return .settingsReset(try settingsReset(request))
    case .settingsSet(let request):
      return .settingsSet(try settingsSet(request))
    case .settingsValidate(let request):
      return .settingsValidate(settingsValidate(request))
    case .treeSnapshot:
      return .treeSnapshot(treeSnapshot())
    case .notify(let notifyRequest):
      return .notify(try notify(notifyRequest))
    case .agentHook(let hookRequest):
      return .agentHook(try handleAgentHook(hookRequest))
    case .quit:
      onQuitRequested?()
      return .quit
    }
  }

  func execute(
    _ request: SocketRequestExecutor.AgentIntegrationRequest
  ) async throws -> SocketRequestExecutor.AgentIntegrationResult {
    switch request {
    case .detectionReload:
      return .detectionReload(try await agentDetectionReload())
    case .hooksInstall(let request):
      return .hooksInstall(try await hooksInstall(request))
    case .hooksRemove(let request):
      return .hooksRemove(try await hooksRemove(request))
    case .skillsGet(let request):
      return .skillsGet(try skillsGet(request))
    case .skillsInstall:
      return .skillsInstall(try skillsInstall())
    case .skillsList:
      return .skillsList(try skillsList())
    case .skillsPath(let request):
      return .skillsPath(try skillsPath(request))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalCreationRequest
  ) throws -> SocketRequestExecutor.TerminalCreationResult {
    switch request {
    case .createTab(let createTabRequest):
      return .createTab(try createTab(createTabRequest))
    case .createPane(let createPaneRequest):
      return .createPane(try createPane(createPaneRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalPaneRequest
  ) async throws -> SocketRequestExecutor.TerminalPaneResult {
    switch request {
    case .agentExplain(let target):
      return .agentExplain(try await agentDetectionExplain(target))
    case .focusPane(let target):
      return .focusPane(try focusPane(target))
    case .lastPane(let target):
      return .lastPane(try lastPane(target))
    case .closePane(let target):
      return .closePane(try closePane(target))
    case .sendText(let sendTextRequest):
      return .sendText(try sendText(sendTextRequest))
    case .sendKey(let sendKeyRequest):
      return .sendKey(try sendKey(sendKeyRequest))
    case .capturePane(let capturePaneRequest):
      return .capturePane(try capturePane(capturePaneRequest))
    case .screenshotPane(let target):
      return .screenshotPane(try screenshotPane(target))
    case .paneHealth(let paneHealthRequest):
      return .paneHealth(try paneHealth(paneHealthRequest))
    case .resizePane(let resizePaneRequest):
      return .resizePane(try resizePane(resizePaneRequest))
    case .setPaneSize(let setPaneSizeRequest):
      return .setPaneSize(try setPaneSize(setPaneSizeRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalTabRequest
  ) throws -> SocketRequestExecutor.TerminalTabResult {
    switch request {
    case .tilePanes(let tilePanesRequest):
      return .tilePanes(try tilePanes(tilePanesRequest))
    case .equalizePanes(let equalizePanesRequest):
      return .equalizePanes(try equalizePanes(equalizePanesRequest))
    case .mainVerticalPanes(let mainVerticalPanesRequest):
      return .mainVerticalPanes(try mainVerticalPanes(mainVerticalPanesRequest))
    case .selectTab(let target):
      return .selectTab(try selectTab(target))
    case .pinTab(let target):
      return .pinTab(try pinTab(target))
    case .unpinTab(let target):
      return .unpinTab(try unpinTab(target))
    case .closeTab(let target):
      return .closeTab(try closeTab(target))
    case .renameTab(let renameTabRequest):
      return .renameTab(try renameTab(renameTabRequest))
    case .nextTab(let navigationRequest):
      return .nextTab(try nextTab(navigationRequest))
    case .previousTab(let navigationRequest):
      return .previousTab(try previousTab(navigationRequest))
    case .lastTab(let navigationRequest):
      return .lastTab(try lastTab(navigationRequest))
    case .moveTab(let request):
      do {
        return .moveTab(try registry.moveTab(request))
      } catch let error as TerminalTabMoveError {
        throw TerminalTabCommandError.invalidRequest(error.commandMessage)
      }
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalSpaceRequest
  ) throws -> SocketRequestExecutor.TerminalSpaceResult {
    switch request {
    case .createSpace(let createSpaceRequest):
      return .createSpace(try createSpace(createSpaceRequest))
    case .selectSpace(let target):
      return .selectSpace(try selectSpace(target))
    case .closeSpace(let target):
      return .closeSpace(try closeSpace(target))
    case .renameSpace(let renameSpaceRequest):
      return .renameSpace(try renameSpace(renameSpaceRequest))
    case .setSpaceColor(let setSpaceColorRequest):
      return .setSpaceColor(try setSpaceColor(setSpaceColorRequest))
    case .nextSpace(let navigationRequest):
      return .nextSpace(try nextSpace(navigationRequest))
    case .previousSpace(let navigationRequest):
      return .previousSpace(try previousSpace(navigationRequest))
    case .lastSpace(let navigationRequest):
      return .lastSpace(try lastSpace(navigationRequest))
    }
  }
}

extension TerminalTabMoveError {
  fileprivate var commandMessage: String {
    switch self {
    case .duplicateTab:
      "Each Tab can only be moved once."
    case .emptyTabs:
      "At least one Tab is required."
    case .invalidDestination(let destination):
      "Tab index \(destination.index + 1) is outside the destination section."
    case .staleProjects:
      "Project order changed. Retry the request."
    case .staleTopology:
      "Tab order changed. Retry the request."
    case .tabNotFound:
      "The Tab was not found."
    }
  }
}
