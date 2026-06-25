import Foundation
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalModels

extension TerminalHostState {
  func configureBridgeCallbacks(
    for view: GhosttySurfaceView,
    tabID: TerminalTabID
  ) {
    view.bridge.onTitleChange = { [weak self] _ in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
      self.sessionDidChange()
    }
    view.bridge.onPathChange = { [weak self] in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
      self.persistPinnedTabWorkingDirectoriesIfNeeded(for: tabID)
      self.agentPanelController?.surfacePathChanged(view.id)
      self.sessionDidChange()
    }
    view.bridge.onTabTitleChange = { [weak self] title in
      guard let self else { return false }
      self.setLockedTabTitle(title, for: tabID)
      return true
    }
    view.bridge.onPromptTabTitle = { [weak self, weak view] in
      guard let self, let view else { return }
      self.promptTabTitle(for: tabID, using: view)
    }
    view.bridge.onCopyTitleToClipboard = { [weak self, weak view] in
      guard let self, let view else { return false }
      return self.copyTitleToClipboard(for: view.id)
    }
    view.bridge.onSplitAction = { [weak self, weak view] action in
      guard let self, let view else { return false }
      return self.performSplitAction(action, for: view.id)
    }
    view.bridge.onNewTab = { [weak self, weak view] in
      guard let self else { return false }
      self.emit(.newTabRequested(inheritingFromSurfaceID: view?.id))
      return true
    }
    view.bridge.onCloseTab = { [weak self] _ in
      guard let self else { return false }
      self.requestCloseTab(tabID)
      return true
    }
    view.bridge.onGotoTab = { [weak self] target in
      guard let self else { return false }
      guard let mappedTarget = self.mapGotoTabTarget(target) else { return false }
      self.emit(.gotoTabRequested(mappedTarget))
      return true
    }
    view.bridge.onCommandPaletteToggle = { [weak self] in
      guard let self else { return false }
      self.emit(.commandPaletteToggleRequested)
      return true
    }
    view.bridge.onProgressReport = { [weak self] _ in
      guard let self else { return }
      self.updateRunningState(for: tabID)
    }
    view.bridge.onCommandFinished = { [weak self, weak view] in
      guard let self, let view else { return }
      self.handleCommandFinished(for: view.id)
    }
    configureBridgeCloseCallbacks(for: view)
    view.bridge.onDesktopNotification = { [weak self, weak view] title, body in
      guard let self, let view else { return }
      self.handleDesktopNotification(
        body: body,
        surfaceID: view.id,
        title: title
      )
    }
  }

  func handleCommandFinished(for surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    let removedAgentPresence = clearAgentPresence(for: surfaceID)
    let hadAgentMetadata = paneAgentMetadataBySurfaceID[surfaceID]?.isEmpty == false
    _ = clearAgentPanelMetadata(for: surfaceID)
    agentPanelController?.surfaceCommandFinished(surfaceID)
    onSurfaceCommandFinished(surfaceID)
    if hadAgentMetadata || removedAgentPresence {
      sessionDidChange()
    }
  }

  func configureBridgeCloseCallbacks(for view: GhosttySurfaceView) {
    view.bridge.onChildExited = { [weak self, weak view] in
      guard let self, let view else { return false }
      self.requestCloseSurfaceAfterProcessExit(
        view.id,
        source: .ghosttyChildExit
      )
      return true
    }
    view.bridge.onCloseRequest = { [weak self, weak view] processAlive in
      guard let self, let view else { return }
      guard !processAlive else {
        self.requestCloseSurface(
          view.id,
          needsConfirmation: true,
          source: .ghosttyCloseSurfaceCallback
        )
        return
      }
      self.requestCloseSurfaceAfterProcessExit(
        view.id,
        source: .ghosttyCloseSurfaceCallback
      )
    }
  }

  func configureSurfaceCallbacks(
    for view: GhosttySurfaceView,
    tabID: TerminalTabID
  ) {
    view.onDirectInteraction = { [weak self, weak view] in
      guard let self, let view else { return }
      self.handleDirectInteraction(on: view.id)
    }
    view.onFocusChange = { [weak self, weak view] focused in
      guard let self, let view, focused else { return }
      self.applyFocusedSurface(view.id, in: tabID)
      self.updateTabTitle(for: tabID)
      self.updateRunningState(for: tabID)
      self.clearNotificationAttention(for: view.id)
      self.emitFocusChangedIfNeeded(view.id)
      self.agentPanelController?.surfaceFocused(view.id)
      self.sessionDidChange()
    }
  }
}
