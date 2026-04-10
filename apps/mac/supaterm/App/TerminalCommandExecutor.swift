import SupatermSocketFeature

@MainActor
final class TerminalCommandExecutor {
  private let registry: TerminalWindowRegistry

  init(registry: TerminalWindowRegistry) {
    self.registry = registry
  }

  func execute(_ request: SocketRequestExecutor.AppRequest) throws -> SocketRequestExecutor.AppResult {
    switch request {
    case .onboardingSnapshot:
      return .onboardingSnapshot(registry.onboardingSnapshot())
    case .debugSnapshot(let debugRequest):
      return .debugSnapshot(registry.debugSnapshot(debugRequest))
    case .treeSnapshot:
      return .treeSnapshot(registry.treeSnapshot())
    case .notify(let notifyRequest):
      return .notify(try registry.notify(notifyRequest))
    case .agentHook(let hookRequest):
      return .agentHook(try registry.handleAgentHook(hookRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalCreationRequest
  ) throws -> SocketRequestExecutor.TerminalCreationResult {
    switch request {
    case .createTab(let createTabRequest):
      return .createTab(try registry.createTab(createTabRequest))
    case .createPane(let createPaneRequest):
      return .createPane(try registry.createPane(createPaneRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalPaneRequest
  ) throws -> SocketRequestExecutor.TerminalPaneResult {
    switch request {
    case .focusPane(let target):
      return .focusPane(try registry.focusPane(target))
    case .lastPane(let target):
      return .lastPane(try registry.lastPane(target))
    case .closePane(let target):
      return .closePane(try registry.closePane(target))
    case .sendText(let sendTextRequest):
      return .sendText(try registry.sendText(sendTextRequest))
    case .sendKey(let sendKeyRequest):
      return .sendKey(try registry.sendKey(sendKeyRequest))
    case .capturePane(let capturePaneRequest):
      return .capturePane(try registry.capturePane(capturePaneRequest))
    case .resizePane(let resizePaneRequest):
      return .resizePane(try registry.resizePane(resizePaneRequest))
    case .setPaneSize(let setPaneSizeRequest):
      return .setPaneSize(try registry.setPaneSize(setPaneSizeRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalTabRequest
  ) throws -> SocketRequestExecutor.TerminalTabResult {
    switch request {
    case .tilePanes(let tilePanesRequest):
      return .tilePanes(try registry.tilePanes(tilePanesRequest))
    case .equalizePanes(let equalizePanesRequest):
      return .equalizePanes(try registry.equalizePanes(equalizePanesRequest))
    case .mainVerticalPanes(let mainVerticalPanesRequest):
      return .mainVerticalPanes(try registry.mainVerticalPanes(mainVerticalPanesRequest))
    case .selectTab(let target):
      return .selectTab(try registry.selectTab(target))
    case .closeTab(let target):
      return .closeTab(try registry.closeTab(target))
    case .renameTab(let renameTabRequest):
      return .renameTab(try registry.renameTab(renameTabRequest))
    case .nextTab(let navigationRequest):
      return .nextTab(try registry.nextTab(navigationRequest))
    case .previousTab(let navigationRequest):
      return .previousTab(try registry.previousTab(navigationRequest))
    case .lastTab(let navigationRequest):
      return .lastTab(try registry.lastTab(navigationRequest))
    }
  }

  func execute(
    _ request: SocketRequestExecutor.TerminalSpaceRequest
  ) throws -> SocketRequestExecutor.TerminalSpaceResult {
    switch request {
    case .createSpace(let createSpaceRequest):
      return .createSpace(try registry.createSpace(createSpaceRequest))
    case .selectSpace(let target):
      return .selectSpace(try registry.selectSpace(target))
    case .closeSpace(let target):
      return .closeSpace(try registry.closeSpace(target))
    case .renameSpace(let renameSpaceRequest):
      return .renameSpace(try registry.renameSpace(renameSpaceRequest))
    case .nextSpace(let navigationRequest):
      return .nextSpace(try registry.nextSpace(navigationRequest))
    case .previousSpace(let navigationRequest):
      return .previousSpace(try registry.previousSpace(navigationRequest))
    case .lastSpace(let navigationRequest):
      return .lastSpace(try registry.lastSpace(navigationRequest))
    }
  }
}
