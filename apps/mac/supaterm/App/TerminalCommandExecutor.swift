import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore

@MainActor
final class TerminalCommandExecutor {
  let agentMonitorStore: TerminalAgentMonitorStore
  unowned let registry: TerminalWindowRegistry
  var onQuitRequested: (() -> Void)?

  init<C: Clock<Duration>>(
    registry: TerminalWindowRegistry,
    agentRunningTimeout: Duration = .seconds(30),
    transcriptEventDelay: Duration = .zero,
    clock: C = ContinuousClock()
  ) {
    self.registry = registry
    let sleep = { (duration: Duration) in
      try await clock.sleep(for: duration)
    }
    agentMonitorStore = TerminalAgentMonitorStore(
      agentRunningTimeout: agentRunningTimeout,
      transcriptEventDelay: transcriptEventDelay,
      sleep: sleep
    )
    agentMonitorStore.onMonitorSnapshot = { [weak self] snapshot, scope, context in
      self?.handleMonitorSnapshot(snapshot, scope: scope, context: context)
    }
    agentMonitorStore.onRunningTimeoutExpired = { [weak self] agent, sessionID, context in
      self?.handleRunningTimeoutExpired(agent: agent, sessionID: sessionID, context: context)
    }
  }

  func executeTargeted<Result>(
    operation: (TerminalWindowRegistry.Entry) throws -> Result,
    rewrite: (Result, Int) -> Result
  ) throws -> Result {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        return rewrite(try operation(entry), offset + 1)
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
  ) throws -> SocketRequestExecutor.TerminalPaneResult {
    switch request {
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
    case .nextSpace(let navigationRequest):
      return .nextSpace(try nextSpace(navigationRequest))
    case .previousSpace(let navigationRequest):
      return .previousSpace(try previousSpace(navigationRequest))
    case .lastSpace(let navigationRequest):
      return .lastSpace(try lastSpace(navigationRequest))
    }
  }
}
