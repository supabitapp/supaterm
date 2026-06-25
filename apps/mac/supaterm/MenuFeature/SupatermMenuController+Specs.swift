import AppKit
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

enum MenuItemIdentifier {
  static let about = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.about")
  static let checkForUpdates = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.checkForUpdates")
  static let quit = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.quit")
  static let quitTerminatingSessions = NSUserInterfaceItemIdentifier(
    "app.supabit.supaterm.app.quitTerminatingSessions")
  static let settings = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.settings")
  static let newWindow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newWindow")
  static let newTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newTab")
  static let splitRight = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.splitRight")
  static let splitLeft = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.splitLeft")
  static let splitDown = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.splitDown")
  static let splitUp = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.splitUp")
  static let closeSurface = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.close")
  static let closeTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.closeTab")
  static let closeWindow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.closeWindow")
  static let closeAllWindows = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.closeAllWindows")
  static let terminateAllTerminalSessions = NSUserInterfaceItemIdentifier(
    "app.supabit.supaterm.file.terminateAllTerminalSessions")
  static let openCommandPalette = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.openCommandPalette")
  static let copy = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.copy")
  static let paste = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.paste")
  static let pasteSelection = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.pasteSelection")
  static let selectAll = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.selectAll")
  static let find = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.find")
  static let findNext = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findNext")
  static let findPrevious = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findPrevious")
  static let hideFindBar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.hideFindBar")
  static let selectionForFind = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.selectionForFind")
  static let toggleSidebar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.toggleSidebar")
  static let toggleAgentPanel = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.toggleAgentPanel")
  static let forkAgentSession = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.forkAgentSession")
  static let copyAgentSessionID = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.copyAgentSessionID")
  static let changeTabTitle = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.changeTabTitle")
  static let changeTerminalTitle = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.changeTerminalTitle")
  static let nextTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.next")
  static let previousTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.previous")
  static let selectLastTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.last")
  static let selectTabPrefix = "app.supabit.supaterm.tabs.select."
  static let selectSpacePrefix = "app.supabit.supaterm.spaces.select."
  static let zoomSplit = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.zoomSplit")
  static let previousSplit = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.previousSplit")
  static let nextSplit = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.nextSplit")
  static let selectSplitAbove = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.selectSplitAbove")
  static let selectSplitBelow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.selectSplitBelow")
  static let selectSplitLeft = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.selectSplitLeft")
  static let selectSplitRight = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.selectSplitRight")
  static let equalizeSplits = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.equalizeSplits")
  static let moveSplitDividerUp = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.moveSplitDividerUp")
  static let moveSplitDividerDown = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.moveSplitDividerDown")
  static let moveSplitDividerLeft = NSUserInterfaceItemIdentifier("app.supabit.supaterm.window.moveSplitDividerLeft")
  static let moveSplitDividerRight = NSUserInterfaceItemIdentifier(
    "app.supabit.supaterm.window.moveSplitDividerRight")
  static let submitGitHubIssue = NSUserInterfaceItemIdentifier("app.supabit.supaterm.help.submitGitHubIssue")
  static let changelog = NSUserInterfaceItemIdentifier("app.supabit.supaterm.help.changelog")
}
extension SupatermMenuController {
  func menuItemSpecs() -> [SupatermMenuItemSpec] {
    appMenuSpecs() + fileMenuSpecs() + editMenuSpecs() + viewMenuSpecs()
      + tabsMenuSpecs() + spacesMenuSpecs() + windowMenuSpecs() + helpMenuSpecs()
  }

  private func appMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.about,
        title: "About \(appName)",
        action: #selector(about(_:))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.settings,
        title: "Settings...",
        action: #selector(showSettings(_:)),
        shortcut: .ghosttyAction(
          "open_config",
          defaultShortcut: KeyboardShortcut(",", modifiers: .command)
        )
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.checkForUpdates,
        title: "Check for Updates...",
        action: #selector(checkForUpdates(_:)),
        shortcut: .ghosttyAction(
          "check_for_updates",
          defaultShortcut: KeyboardShortcut("u", modifiers: [.command, .shift])
        )
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.quitTerminatingSessions,
        title: "Quit \(appName) and Close All Sessions",
        action: #selector(quitTerminatingSessions(_:))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.quit,
        title: "Quit \(appName)",
        action: #selector(quit(_:)),
        shortcut: .ghosttyAction(
          "quit",
          defaultShortcut: KeyboardShortcut("q", modifiers: .command)
        )
      ),
    ]
  }

  private func fileMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.newWindow,
        title: "New Window",
        action: #selector(newWindow(_:)),
        symbol: "macwindow.badge.plus",
        shortcut: .command(.newWindow)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.newTab,
        title: "New Tab",
        action: #selector(newTab(_:)),
        symbol: "macwindow",
        shortcut: .command(.newTab)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.openCommandPalette,
        title: "Open Command Palette",
        action: #selector(openCommandPalette(_:)),
        symbol: "magnifyingglass",
        shortcut: .ghosttyAction(
          "toggle_command_palette",
          defaultShortcut: KeyboardShortcut("p", modifiers: [.command, .shift])
        )
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.splitRight,
        title: "Split Right",
        action: #selector(splitRight(_:)),
        symbol: "rectangle.righthalf.inset.filled",
        shortcut: .command(.newSplit(.right))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.splitLeft,
        title: "Split Left",
        action: #selector(splitLeft(_:)),
        symbol: "rectangle.leadinghalf.inset.filled",
        shortcut: .command(.newSplit(.left))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.splitDown,
        title: "Split Down",
        action: #selector(splitDown(_:)),
        symbol: "rectangle.bottomhalf.inset.filled",
        shortcut: .command(.newSplit(.down))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.splitUp,
        title: "Split Up",
        action: #selector(splitUp(_:)),
        symbol: "rectangle.tophalf.inset.filled",
        shortcut: .command(.newSplit(.up))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.closeSurface,
        title: "Close Pane",
        action: #selector(closeSurface(_:)),
        symbol: "xmark",
        shortcut: .command(.closeSurface)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.closeTab,
        title: "Close Tab",
        action: #selector(closeTab(_:)),
        shortcut: .command(.closeTab)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.closeWindow,
        title: "Close Window",
        action: #selector(closeWindow(_:)),
        shortcut: .command(.closeWindow)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.closeAllWindows,
        title: "Close All Windows",
        action: #selector(closeAllWindows(_:)),
        shortcut: .command(.closeAllWindows)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.terminateAllTerminalSessions,
        title: "Terminate All Terminal Sessions...",
        action: #selector(terminateAllTerminalSessions(_:))
      ),
    ]
  }

  private func editMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.copy,
        title: "Copy",
        action: NSSelectorFromString("copy:"),
        shortcut: .command(.copyToClipboard),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.paste,
        title: "Paste",
        action: NSSelectorFromString("paste:"),
        shortcut: .command(.pasteFromClipboard),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.pasteSelection,
        title: "Paste Selection",
        action: NSSelectorFromString("pasteSelection:"),
        shortcut: .command(.pasteFromSelection),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectAll,
        title: "Select All",
        action: NSSelectorFromString("selectAll:"),
        shortcut: .command(.selectAll),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.find,
        title: "Find...",
        action: #selector(find(_:)),
        shortcut: .command(.startSearch)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.findNext,
        title: "Find Next",
        action: #selector(findNext(_:)),
        shortcut: .command(.navigateSearch(.next))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.findPrevious,
        title: "Find Previous",
        action: #selector(findPrevious(_:)),
        shortcut: .command(.navigateSearch(.previous))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.hideFindBar,
        title: "Hide Find Bar",
        action: #selector(findHide(_:)),
        shortcut: .command(.endSearch)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectionForFind,
        title: "Use Selection for Find",
        action: #selector(selectionForFind(_:)),
        shortcut: .command(.searchSelection)
      ),
    ]
  }

  private func viewMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.toggleSidebar,
        title: "Toggle Sidebar",
        action: #selector(toggleSidebar(_:)),
        shortcut: .fixed(KeyboardShortcut("s", modifiers: .command))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.toggleAgentPanel,
        title: "Toggle Agent Panel",
        action: #selector(toggleAgentPanel(_:)),
        shortcut: .fixed(AgentPanelShortcut.toggleVisibility)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.forkAgentSession,
        title: "Fork Agent Session",
        action: #selector(forkAgentSession(_:)),
        shortcut: .fixedRouted(AgentPanelShortcut.forkSession)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.copyAgentSessionID,
        title: "Copy Agent Session ID",
        action: #selector(copyAgentSessionID(_:)),
        shortcut: .fixedRouted(AgentPanelShortcut.copySessionID)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.changeTabTitle,
        title: "Change Tab Title...",
        action: #selector(changeTabTitle(_:)),
        symbol: "pencil.line",
        shortcut: .command(.promptTabTitle)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.changeTerminalTitle,
        title: "Change Terminal Title...",
        action: #selector(changeTerminalTitle(_:)),
        symbol: "pencil.line",
        shortcut: .command(.promptSurfaceTitle)
      ),
    ]
  }

  private func tabsMenuSpecs() -> [SupatermMenuItemSpec] {
    var specs: [SupatermMenuItemSpec] = [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.nextTab,
        title: "Next Tab",
        action: #selector(nextTab(_:)),
        shortcut: .command(.nextTab)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.previousTab,
        title: "Previous Tab",
        action: #selector(previousTab(_:)),
        shortcut: .command(.previousTab)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectLastTab,
        title: "Last Tab",
        action: #selector(selectLastTab(_:)),
        shortcut: .command(.lastTab)
      ),
    ]
    let lastTab = specs.removeLast()
    specs.append(
      contentsOf: (1...10).map { slot in
        SupatermMenuItemSpec(
          id: NSUserInterfaceItemIdentifier(MenuItemIdentifier.selectTabPrefix + "\(slot)"),
          title: "Tab \(slot)",
          action: #selector(selectTab(_:)),
          shortcut: .command(.goToTab(slot)),
          slot: slot
        )
      }
    )
    specs.append(lastTab)
    return specs
  }

  private func spacesMenuSpecs() -> [SupatermMenuItemSpec] {
    (1...10).map { slot in
      SupatermMenuItemSpec(
        id: NSUserInterfaceItemIdentifier(MenuItemIdentifier.selectSpacePrefix + "\(slot)"),
        title: "Space \(slot)",
        action: #selector(selectSpace(_:)),
        shortcut: .fixed(
          KeyboardShortcut(
            KeyEquivalent(Character(slot == 10 ? "0" : "\(slot)")),
            modifiers: .control
          )
        ),
        slot: slot
      )
    }
  }

  private func windowMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.zoomSplit,
        title: "Zoom Split",
        action: #selector(zoomSplit(_:)),
        symbol: "arrow.up.left.and.arrow.down.right",
        shortcut: .command(.toggleSplitZoom)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.previousSplit,
        title: "Select Previous Split",
        action: #selector(previousSplit(_:)),
        symbol: "chevron.backward.2",
        shortcut: .command(.goToSplit(.previous))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.nextSplit,
        title: "Select Next Split",
        action: #selector(nextSplit(_:)),
        symbol: "chevron.forward.2",
        shortcut: .command(.goToSplit(.next))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectSplitAbove,
        title: "Select Split Above",
        action: #selector(selectSplitAbove(_:)),
        symbol: "arrow.up",
        shortcut: .command(.goToSplit(.up))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectSplitBelow,
        title: "Select Split Below",
        action: #selector(selectSplitBelow(_:)),
        symbol: "arrow.down",
        shortcut: .command(.goToSplit(.down))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectSplitLeft,
        title: "Select Split Left",
        action: #selector(selectSplitLeft(_:)),
        symbol: "arrow.left",
        shortcut: .command(.goToSplit(.left))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectSplitRight,
        title: "Select Split Right",
        action: #selector(selectSplitRight(_:)),
        symbol: "arrow.right",
        shortcut: .command(.goToSplit(.right))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.equalizeSplits,
        title: "Equalize Panes",
        action: #selector(equalizeSplits(_:)),
        symbol: "inset.filled.topleft.topright.bottomleft.bottomright.rectangle",
        shortcut: .command(.equalizeSplits)
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.moveSplitDividerUp,
        title: "Move Divider Up",
        action: #selector(moveSplitDividerUp(_:)),
        symbol: "arrow.up.to.line",
        shortcut: .command(.resizeSplit(.up, 10))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.moveSplitDividerDown,
        title: "Move Divider Down",
        action: #selector(moveSplitDividerDown(_:)),
        symbol: "arrow.down.to.line",
        shortcut: .command(.resizeSplit(.down, 10))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.moveSplitDividerLeft,
        title: "Move Divider Left",
        action: #selector(moveSplitDividerLeft(_:)),
        symbol: "arrow.left.to.line",
        shortcut: .command(.resizeSplit(.left, 10))
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.moveSplitDividerRight,
        title: "Move Divider Right",
        action: #selector(moveSplitDividerRight(_:)),
        symbol: "arrow.right.to.line",
        shortcut: .command(.resizeSplit(.right, 10))
      ),
    ]
  }

  private func helpMenuSpecs() -> [SupatermMenuItemSpec] {
    [
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.changelog,
        title: "Changelog",
        action: #selector(openChangelog(_:)),
        symbol: "list.bullet.rectangle"
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.submitGitHubIssue,
        title: "Submit GitHub Issue",
        action: #selector(submitGitHubIssue(_:)),
        symbol: "exclamationmark.bubble"
      ),
    ]
  }

}
