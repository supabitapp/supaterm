import AppKit
import SupatermAppFeature

extension SupatermMenuController: NSMenuItemValidation {
  public func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let context = registry.menuContext()

    switch item.identifier {
    case MenuItemIdentifier.checkForUpdates:
      item.title = context.updateMenuItemText
      return context.isUpdateMenuItemEnabled
    case MenuItemIdentifier.newTab:
      return context.availability.hasWindow
    case MenuItemIdentifier.openCommandPalette:
      return context.availability.hasWindow
    case MenuItemIdentifier.splitRight,
      MenuItemIdentifier.splitLeft,
      MenuItemIdentifier.splitDown,
      MenuItemIdentifier.splitUp:
      return context.availability.hasSurface
    case MenuItemIdentifier.closeSurface:
      return context.availability.hasSurface || context.closesKeyWindowDirectly
    case MenuItemIdentifier.closeTab:
      return context.availability.hasTab
    case MenuItemIdentifier.closeWindow,
      MenuItemIdentifier.closeAllWindows,
      MenuItemIdentifier.toggleSidebar:
      return context.availability.hasWindow
    case MenuItemIdentifier.toggleAgentPanel:
      return context.availability.hasAgentPanel
    case MenuItemIdentifier.forkAgentSession,
      MenuItemIdentifier.copyAgentSessionID:
      return context.availability.hasAgentPanelSession
    case MenuItemIdentifier.terminateAllTerminalSessions:
      return context.availability.hasAnySurface
    case MenuItemIdentifier.find,
      MenuItemIdentifier.findNext,
      MenuItemIdentifier.findPrevious,
      MenuItemIdentifier.changeTerminalTitle,
      MenuItemIdentifier.selectionForFind,
      MenuItemIdentifier.zoomSplit,
      MenuItemIdentifier.previousSplit,
      MenuItemIdentifier.nextSplit,
      MenuItemIdentifier.selectSplitAbove,
      MenuItemIdentifier.selectSplitBelow,
      MenuItemIdentifier.selectSplitLeft,
      MenuItemIdentifier.selectSplitRight,
      MenuItemIdentifier.equalizeSplits,
      MenuItemIdentifier.moveSplitDividerUp,
      MenuItemIdentifier.moveSplitDividerDown,
      MenuItemIdentifier.moveSplitDividerLeft,
      MenuItemIdentifier.moveSplitDividerRight:
      return context.availability.hasSurface
    case MenuItemIdentifier.hideFindBar:
      return context.hasSearch
    case MenuItemIdentifier.nextTab,
      MenuItemIdentifier.previousTab,
      MenuItemIdentifier.changeTabTitle,
      MenuItemIdentifier.selectLastTab:
      return context.visibleTabCount > 0
    default:
      return validateIndexedMenuItem(item, context: context)
    }
  }

  private func validateIndexedMenuItem(
    _ item: NSMenuItem,
    context: TerminalWindowRegistry.MenuContext
  ) -> Bool {
    guard let identifier = item.identifier?.rawValue else { return true }
    if let slot = Int(identifier.replacingOccurrences(of: MenuItemIdentifier.selectTabPrefix, with: "")),
      identifier.hasPrefix(MenuItemIdentifier.selectTabPrefix)
    {
      return context.visibleTabCount >= slot
    }
    if let slot = Int(identifier.replacingOccurrences(of: MenuItemIdentifier.selectSpacePrefix, with: "")),
      identifier.hasPrefix(MenuItemIdentifier.selectSpacePrefix)
    {
      return context.spaceCount >= slot
    }
    return true
  }
}
