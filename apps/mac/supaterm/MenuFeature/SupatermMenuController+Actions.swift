import AppKit
import SupatermAppFeature
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermSettingsFeature
import SupatermSupport
import SupatermTerminalModels

extension SupatermMenuController {
  @discardableResult
  func performNewWindow() -> Bool {
    requestNewWindow()
  }

  @discardableResult
  func performShowSettings(_ tab: SettingsFeature.Tab) -> Bool {
    requestShowSettings(tab)
  }

  @discardableResult
  func performUpdateMenuAction() -> Bool {
    registry.requestUpdateMenuActionInKeyWindow()
  }

  @discardableResult
  public func performCheckForUpdates() -> Bool {
    performUpdateMenuAction()
  }

  @discardableResult
  func performOpenChangelog() -> Bool {
    ExternalNavigationClient.liveValue.open(SupatermExternalURL.changelog)
  }

  @discardableResult
  func performSubmitGitHubIssue() -> Bool {
    requestSubmitGitHubIssue()
  }

  @discardableResult
  func performQuit() -> Bool {
    if let performer = NSApp.delegate as? any GhosttyAppActionPerforming {
      return performer.performQuit()
    }
    NSApp.terminate(nil)
    return true
  }

  @discardableResult
  func performQuitTerminatingSessions() -> Bool {
    if let performer = NSApp.delegate as? any GhosttyAppActionPerforming {
      return performer.performQuitTerminatingSessions()
    }
    registry.terminateAllTerminalSessions()
    NSApp.terminate(nil)
    return true
  }

  @objc func about(_ sender: Any?) {
    _ = performShowSettings(.about)
  }

  @objc func checkForUpdates(_ sender: Any?) {
    _ = performUpdateMenuAction()
  }

  @objc func quit(_ sender: Any?) {
    _ = performQuit()
  }

  @objc func quitTerminatingSessions(_ sender: Any?) {
    _ = performQuitTerminatingSessions()
  }

  @objc func showSettings(_ sender: Any?) {
    _ = performShowSettings(.general)
  }

  @objc func newWindow(_ sender: Any?) {
    _ = performNewWindow()
  }

  @objc func newTab(_ sender: Any?) {
    registry.requestNewTabInKeyWindow()
  }

  @objc func splitRight(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.newSplit(.right))
  }

  @objc func splitLeft(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.newSplit(.left))
  }

  @objc func splitDown(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.newSplit(.down))
  }

  @objc func splitUp(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.newSplit(.up))
  }

  @objc func closeSurface(_ sender: Any?) {
    _ = performCloseSurface(for: NSApp.keyWindow, sender: sender)
  }

  @objc func closeTab(_ sender: Any?) {
    registry.requestCloseTabInKeyWindow()
  }

  @objc func closeWindow(_ sender: Any?) {
    guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else { return }
    window.performClose(sender)
  }

  @objc func closeAllWindows(_ sender: Any?) {
    _ = registry.requestCloseAllWindows()
  }

  @objc func terminateAllTerminalSessions(_ sender: Any?) {
    registry.terminateAllTerminalSessions()
  }

  @objc func openCommandPalette(_ sender: Any?) {
    registry.requestToggleCommandPaletteInKeyWindow()
  }

  @objc func openChangelog(_ sender: Any?) {
    _ = performOpenChangelog()
  }

  @objc func submitGitHubIssue(_ sender: Any?) {
    _ = performSubmitGitHubIssue()
  }

  @objc func find(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.startSearch)
  }

  @objc func findNext(_ sender: Any?) {
    registry.requestNavigateSearchInKeyWindow(.next)
  }

  @objc func findPrevious(_ sender: Any?) {
    registry.requestNavigateSearchInKeyWindow(.previous)
  }

  @objc func findHide(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.endSearch)
  }

  @objc func selectionForFind(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.searchSelection)
  }

  @objc func toggleSidebar(_ sender: Any?) {
    registry.requestToggleSidebarInKeyWindow()
  }

  @objc func toggleAgentPanel(_ sender: Any?) {
    registry.requestToggleAgentPanelInKeyWindow()
  }

  @objc func forkAgentSession(_ sender: Any?) {
    registry.requestForkAgentPanelSessionInKeyWindow(direction: .right)
  }

  @objc func copyAgentSessionID(_ sender: Any?) {
    registry.requestCopyAgentPanelSessionIDInKeyWindow()
  }

  @objc func changeTabTitle(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.promptTabTitle)
  }

  @objc func changeTerminalTitle(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.promptSurfaceTitle)
  }

  @objc func zoomSplit(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.toggleSplitZoom)
  }

  @objc func previousSplit(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.previous))
  }

  @objc func nextSplit(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.next))
  }

  @objc func selectSplitAbove(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.up))
  }

  @objc func selectSplitBelow(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.down))
  }

  @objc func selectSplitLeft(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.left))
  }

  @objc func selectSplitRight(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.goToSplit(.right))
  }

  @objc func equalizeSplits(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.equalizeSplits)
  }

  @objc func moveSplitDividerUp(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.resizeSplit(.up, 10))
  }

  @objc func moveSplitDividerDown(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.resizeSplit(.down, 10))
  }

  @objc func moveSplitDividerLeft(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.resizeSplit(.left, 10))
  }

  @objc func moveSplitDividerRight(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.resizeSplit(.right, 10))
  }

  @objc func nextTab(_ sender: Any?) {
    registry.requestNextTabInKeyWindow()
  }

  @objc func previousTab(_ sender: Any?) {
    registry.requestPreviousTabInKeyWindow()
  }

  @objc func selectTab(_ sender: Any?) {
    guard let slot = (sender as? NSMenuItem)?.representedObject as? NSNumber else { return }
    registry.requestSelectTabInKeyWindow(slot.intValue)
  }

  @objc func selectLastTab(_ sender: Any?) {
    registry.requestSelectLastTabInKeyWindow()
  }

  @objc func selectSpace(_ sender: Any?) {
    guard let slot = (sender as? NSMenuItem)?.representedObject as? NSNumber else { return }
    registry.requestSelectSpaceInKeyWindow(slot.intValue)
  }

  @discardableResult
  func performCloseSurface(for keyWindow: NSWindow?, sender: Any?) -> Bool {
    if registry.closesWindowDirectly(keyWindow) {
      SupatermLog.notice(
        SupatermLog.terminal,
        "terminal.close.menuRequest",
        fields: ["target=nonTerminalWindow"]
      )
      keyWindow?.performClose(sender)
      return true
    }
    SupatermLog.notice(
      SupatermLog.terminal,
      "terminal.close.menuRequest",
      fields: ["target=terminalSurface"]
    )
    registry.requestCloseSurfaceInKeyWindow()
    return true
  }
}
