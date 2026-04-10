import SupatermTerminalCore

extension TerminalWindowsClient {
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
