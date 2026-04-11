import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature

@MainActor
final class TerminalCommandExecutor: TerminalAgentSessionStoreDelegate {
  let agentSessionStore: TerminalAgentSessionStore
  unowned let registry: TerminalWindowRegistry

  init<C: Clock<Duration>>(
    registry: TerminalWindowRegistry,
    agentRunningTimeout: Duration = .seconds(15),
    transcriptPollInterval: Duration = .seconds(1),
    clock: C = ContinuousClock()
  ) {
    self.registry = registry
    let sleep = { (duration: Duration) in
      try await clock.sleep(for: duration)
    }
    agentSessionStore = TerminalAgentSessionStore(
      agentRunningTimeout: agentRunningTimeout,
      transcriptPollInterval: transcriptPollInterval,
      sleep: sleep
    )
    agentSessionStore.delegate = self
  }

  func attach(terminal: TerminalHostState) {
    terminal.onCommandFinished = { [weak self] surfaceID in
      self?.agentSessionStore.clearSessions(for: surfaceID)
    }
  }

  func execute(_ request: SocketRequestExecutor.AppRequest) throws -> SocketRequestExecutor.AppResult {
    switch request {
    case .onboardingSnapshot:
      return .onboardingSnapshot(onboardingSnapshot())
    case .debugSnapshot(let debugRequest):
      return .debugSnapshot(debugSnapshot(debugRequest))
    case .treeSnapshot:
      return .treeSnapshot(treeSnapshot())
    case .notify(let notifyRequest):
      return .notify(try notify(notifyRequest))
    case .agentHook(let hookRequest):
      return .agentHook(try handleAgentHook(hookRequest))
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
