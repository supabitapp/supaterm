import AppKit
import SupatermSettingsFeature
import SupatermSupport
import SwiftUI

@MainActor
final class SupatermMenuController: NSObject {
  private struct MenuShortcutKey: Equatable {
    let keyEquivalent: String
    let modifierMask: NSEvent.ModifierFlags

    init(shortcut: KeyboardShortcut) {
      self.keyEquivalent = shortcut.key.character.description.lowercased()
      self.modifierMask = NSEvent.ModifierFlags(swiftUIFlags: shortcut.modifiers)
        .intersection(.deviceIndependentFlagsMask)
    }

    func matches(_ event: NSEvent) -> Bool {
      let eventModifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      guard eventModifiers == modifierMask else { return false }
      let eventKeys = Set([event.charactersIgnoringModifiers, event.characters].compactMap { $0?.lowercased() })
      return eventKeys.contains(keyEquivalent)
    }
  }

  private struct GhosttyBindingMenuItem {
    let shortcut: MenuShortcutKey
    let item: NSMenuItem
  }

  private enum MenuItemIdentifier {
    static let about = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.about")
    static let checkForUpdates = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.checkForUpdates")
    static let quit = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.quit")
    static let quitTerminatingSessions = NSUserInterfaceItemIdentifier(
      "app.supabit.supaterm.app.quitTerminatingSessions")
    static let settings = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.settings")
    static let newWindow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newWindow")
    static let newTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newTab")
    static let newTabInGroup = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newTabInGroup")
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

  private let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  private var keyWindowObservation: NSKeyValueObservation?
  private var firstResponderObservation: NSKeyValueObservation?
  private var requestNewWindow: @MainActor () -> Bool = { false }
  private var requestShowSettings: @MainActor (SettingsFeature.Tab) -> Bool = { _ in false }
  private var requestSubmitGitHubIssue: @MainActor () -> Bool = {
    ExternalNavigationClient.liveValue.open(SupatermExternalURL.submitGitHubIssue)
  }
  private var ghosttyBindingItems: [GhosttyBindingMenuItem] = []

  private var appName: String {
    if let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String,
      !name.isEmpty
    {
      return name
    }
    if let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String,
      !name.isEmpty
    {
      return name
    }
    return ProcessInfo.processInfo.processName
  }

  private lazy var servicesMenu = NSMenu(title: "Services")

  private lazy var topLevelMenus: [String: NSMenu] = {
    var menus: [String: NSMenu] = [:]
    for section in menuLayout() {
      precondition(menus[section.title] == nil, "Duplicate menu section \(section.title)")
      menus[section.title] = buildMenu(title: section.title, entries: section.entries)
    }
    return menus
  }()

  private lazy var mainMenu: NSMenu = {
    let menu = NSMenu(title: "Supaterm")
    for section in menuLayout() {
      menu.addItem(topLevelMenuItem(title: section.title, submenu: topLevelMenu(section.title)))
    }
    return menu
  }()

  private var windowMenu: NSMenu {
    topLevelMenu("Window")
  }

  private var helpMenu: NSMenu {
    topLevelMenu("Help")
  }

  private struct MenuEntry {
    let spec: SupatermMenuItemSpec
    let item: NSMenuItem
  }

  private lazy var menuEntries: [MenuEntry] = menuItemSpecs().map { spec in
    MenuEntry(spec: spec, item: makeItem(from: spec))
  }

  private func menuItem(_ id: NSUserInterfaceItemIdentifier) -> NSMenuItem {
    guard let entry = menuEntries.first(where: { $0.spec.id == id }) else {
      preconditionFailure("Missing menu item spec for \(id.rawValue)")
    }
    return entry.item
  }

  private func slotItems(withPrefix prefix: String) -> [NSMenuItem] {
    menuEntries
      .filter { $0.spec.id?.rawValue.hasPrefix(prefix) == true }
      .map(\.item)
  }

  private func topLevelMenu(_ title: String) -> NSMenu {
    guard let menu = topLevelMenus[title] else {
      preconditionFailure("Missing menu section \(title)")
    }
    return menu
  }

  private func buildMenu(title: String, entries: [SupatermMenuEntrySpec]) -> NSMenu {
    let menu = NSMenu(title: title)
    for entry in entries {
      switch entry {
      case .item(let id):
        menu.addItem(menuItem(id))
      case .separator:
        menu.addItem(.separator())
      case .system(let title, let action, let keyEquivalent, let modifiers):
        let item = systemItem(title: title, action: action, keyEquivalent: keyEquivalent)
        if let modifiers {
          item.keyEquivalentModifierMask = modifiers
        }
        menu.addItem(item)
      case .submenu(let title, let entries):
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = buildMenu(title: title, entries: entries)
        menu.addItem(item)
      case .services(let title):
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = servicesMenu
        menu.addItem(item)
      case .slots(let prefix):
        for item in slotItems(withPrefix: prefix) {
          menu.addItem(item)
        }
      }
    }
    return menu
  }

  func builtMainMenu() -> NSMenu {
    mainMenu
  }

  func menuLayout() -> [SupatermMenuSectionSpec] {
    [
      appMenuLayout(),
      fileMenuLayout(),
      editMenuLayout(),
      viewMenuLayout(),
      tabsMenuLayout(),
      spacesMenuLayout(),
      windowMenuLayout(),
      helpMenuLayout(),
    ]
  }

  private func appMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: appName,
      entries: [
        .item(MenuItemIdentifier.about),
        .item(MenuItemIdentifier.settings),
        .separator,
        .item(MenuItemIdentifier.checkForUpdates),
        .separator,
        .services(title: "Services"),
        .separator,
        .system(
          title: "Hide \(appName)",
          action: #selector(NSApplication.hide(_:)),
          keyEquivalent: "h",
          modifiers: nil
        ),
        .system(
          title: "Hide Others",
          action: #selector(NSApplication.hideOtherApplications(_:)),
          keyEquivalent: "h",
          modifiers: [.command, .option]
        ),
        .system(
          title: "Show All",
          action: #selector(NSApplication.unhideAllApplications(_:)),
          keyEquivalent: "",
          modifiers: nil
        ),
        .separator,
        .item(MenuItemIdentifier.quitTerminatingSessions),
        .item(MenuItemIdentifier.quit),
      ]
    )
  }

  private func fileMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "File",
      entries: [
        .item(MenuItemIdentifier.newWindow),
        .item(MenuItemIdentifier.newTab),
        .item(MenuItemIdentifier.newTabInGroup),
        .item(MenuItemIdentifier.openCommandPalette),
        .separator,
        .item(MenuItemIdentifier.splitRight),
        .item(MenuItemIdentifier.splitLeft),
        .item(MenuItemIdentifier.splitDown),
        .item(MenuItemIdentifier.splitUp),
        .separator,
        .item(MenuItemIdentifier.closeSurface),
        .item(MenuItemIdentifier.closeTab),
        .item(MenuItemIdentifier.closeWindow),
        .item(MenuItemIdentifier.closeAllWindows),
        .separator,
        .item(MenuItemIdentifier.terminateAllTerminalSessions),
      ]
    )
  }

  private func editMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Edit",
      entries: [
        .system(title: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "", modifiers: nil),
        .system(title: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "", modifiers: nil),
        .separator,
        .item(MenuItemIdentifier.copy),
        .item(MenuItemIdentifier.paste),
        .item(MenuItemIdentifier.pasteSelection),
        .item(MenuItemIdentifier.selectAll),
        .separator,
        .submenu(
          title: "Find",
          entries: [
            .item(MenuItemIdentifier.find),
            .item(MenuItemIdentifier.findNext),
            .item(MenuItemIdentifier.findPrevious),
            .separator,
            .item(MenuItemIdentifier.hideFindBar),
            .separator,
            .item(MenuItemIdentifier.selectionForFind),
          ]
        ),
      ]
    )
  }

  private func viewMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "View",
      entries: [
        .item(MenuItemIdentifier.toggleSidebar),
        .item(MenuItemIdentifier.toggleAgentPanel),
        .item(MenuItemIdentifier.forkAgentSession),
        .item(MenuItemIdentifier.copyAgentSessionID),
        .separator,
        .item(MenuItemIdentifier.changeTabTitle),
        .item(MenuItemIdentifier.changeTerminalTitle),
      ]
    )
  }

  private func tabsMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Tabs",
      entries: [
        .item(MenuItemIdentifier.nextTab),
        .item(MenuItemIdentifier.previousTab),
        .separator,
        .slots(prefix: MenuItemIdentifier.selectTabPrefix),
        .item(MenuItemIdentifier.selectLastTab),
      ]
    )
  }

  private func spacesMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Spaces",
      entries: [
        .slots(prefix: MenuItemIdentifier.selectSpacePrefix)
      ]
    )
  }

  private func windowMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Window",
      entries: [
        .system(
          title: "Minimize",
          action: #selector(NSWindow.performMiniaturize(_:)),
          keyEquivalent: "m",
          modifiers: nil
        ),
        .system(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "", modifiers: nil),
        .separator,
        .item(MenuItemIdentifier.zoomSplit),
        .item(MenuItemIdentifier.previousSplit),
        .item(MenuItemIdentifier.nextSplit),
        .submenu(
          title: "Select Split",
          entries: [
            .item(MenuItemIdentifier.selectSplitAbove),
            .item(MenuItemIdentifier.selectSplitBelow),
            .item(MenuItemIdentifier.selectSplitLeft),
            .item(MenuItemIdentifier.selectSplitRight),
          ]
        ),
        .submenu(
          title: "Resize Split",
          entries: [
            .item(MenuItemIdentifier.equalizeSplits),
            .separator,
            .item(MenuItemIdentifier.moveSplitDividerUp),
            .item(MenuItemIdentifier.moveSplitDividerDown),
            .item(MenuItemIdentifier.moveSplitDividerLeft),
            .item(MenuItemIdentifier.moveSplitDividerRight),
          ]
        ),
        .separator,
        .system(
          title: "Bring All to Front",
          action: #selector(NSApplication.arrangeInFront(_:)),
          keyEquivalent: "",
          modifiers: nil
        ),
      ]
    )
  }

  private func helpMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Help",
      entries: [
        .item(MenuItemIdentifier.changelog),
        .item(MenuItemIdentifier.submitGitHubIssue),
      ]
    )
  }

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
        id: MenuItemIdentifier.newTabInGroup,
        title: "New Tab in Group",
        action: #selector(newTabInGroup(_:)),
        symbol: "rectangle.3.group",
        shortcut: .fixedRouted(TerminalTabGroupShortcut.newTab)
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
        action: #selector(GhosttySurfaceView.copy(_:)),
        shortcut: .command(.copyToClipboard),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.paste,
        title: "Paste",
        action: #selector(GhosttySurfaceView.paste(_:)),
        shortcut: .command(.pasteFromClipboard),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.pasteSelection,
        title: "Paste Selection",
        action: #selector(GhosttySurfaceView.pasteSelection(_:)),
        shortcut: .command(.pasteFromSelection),
        targetsController: false
      ),
      SupatermMenuItemSpec(
        id: MenuItemIdentifier.selectAll,
        title: "Select All",
        action: #selector(GhosttySurfaceView.selectAll(_:)),
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

  init(registry: TerminalWindowRegistry) {
    self.registry = registry
  }

  func setNewWindowAction(_ action: @escaping @MainActor () -> Bool) {
    requestNewWindow = action
  }

  func setShowSettingsAction(_ action: @escaping @MainActor (SettingsFeature.Tab) -> Bool) {
    requestShowSettings = action
  }

  func setSubmitGitHubIssueAction(_ action: @escaping @MainActor () -> Bool) {
    requestSubmitGitHubIssue = action
  }

  func install() {
    installObservers()
    NSApp.mainMenu = mainMenu
    NSApp.servicesMenu = servicesMenu
    NSApp.windowsMenu = windowMenu
    NSApp.helpMenu = helpMenu
    refresh()
  }

  func refresh() {
    if NSApp.mainMenu !== mainMenu {
      NSApp.mainMenu = mainMenu
      NSApp.servicesMenu = servicesMenu
      NSApp.windowsMenu = windowMenu
      NSApp.helpMenu = helpMenu
    }

    ghosttyBindingItems = []
    for entry in menuEntries {
      switch entry.spec.shortcut {
      case .command(let command):
        syncShortcut(command: command, item: entry.item)
      case .ghosttyAction(let action, let defaultShortcut):
        syncShortcut(action: action, item: entry.item, defaultShortcut: defaultShortcut)
      case .fixed, .none:
        break
      case .fixedRouted(let shortcut):
        ghosttyBindingItems.insert(
          GhosttyBindingMenuItem(shortcut: MenuShortcutKey(shortcut: shortcut), item: entry.item),
          at: 0
        )
      }
    }
    mainMenu.update()
  }

  @discardableResult
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
    let item =
      ghosttyBindingItems
      .lazy
      .first { $0.shortcut.matches(event) }?.item
    guard let item else { return false }
    if item.identifier == MenuItemIdentifier.settings,
      registry.keyboardShortcut(forAction: "open_config") != nil
    {
      return performShowSettings(.terminal)
    }
    item.menu?.update()
    guard item.isEnabled else { return false }
    guard let action = item.action else { return false }
    return NSApp.sendAction(action, to: item.target, from: item)
  }

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
  func performCheckForUpdates() -> Bool {
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

  @objc func newTabInGroup(_ sender: Any?) {
    registry.requestNewTabInSelectedGroupInKeyWindow()
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

  private func syncShortcut(command: SupatermCommand, item: NSMenuItem?) {
    guard let item else { return }
    if !(NSApp.keyWindow?.firstResponder is GhosttySurfaceView) {
      switch command {
      case .copyToClipboard, .pasteFromClipboard, .selectAll:
        SupatermMenuShortcut.apply(command.defaultKeyboardShortcut, to: item)
        return
      default:
        break
      }
    }
    syncShortcut(
      action: command.ghosttyBindingAction,
      item: item,
      defaultShortcut: command.defaultKeyboardShortcut
    )
  }

  private func syncShortcut(
    action: String,
    item: NSMenuItem?,
    defaultShortcut: KeyboardShortcut? = nil
  ) {
    guard let item else { return }
    if let shortcut = registry.keyboardShortcut(forAction: action) {
      SupatermMenuShortcut.apply(shortcut, to: item)
      syncGhosttyBindingItem(item, shortcut: shortcut)
      return
    }
    if registry.hasShortcutSource {
      SupatermMenuShortcut.apply(nil, to: item)
      return
    }
    SupatermMenuShortcut.apply(defaultShortcut, to: item)
    syncGhosttyBindingItem(item, shortcut: defaultShortcut)
  }

  private func syncGhosttyBindingItem(_ item: NSMenuItem, shortcut: KeyboardShortcut?) {
    guard let shortcut else { return }
    ghosttyBindingItems.append(
      GhosttyBindingMenuItem(
        shortcut: MenuShortcutKey(shortcut: shortcut),
        item: item
      )
    )
  }

  private func installObservers() {
    guard observers.isEmpty else { return }
    keyWindowObservation = NSApp.observe(\.keyWindow, options: [.initial, .new]) { [weak self] app, _ in
      MainActor.assumeIsolated {
        self?.observeFirstResponder(in: app.keyWindow)
      }
    }
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: .ghosttyRuntimeConfigDidChange,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.refresh()
        }
      }
    )
  }

  private func observeFirstResponder(in window: NSWindow?) {
    firstResponderObservation = window?.observe(\.firstResponder) { [weak self] _, _ in
      MainActor.assumeIsolated {
        self?.refresh()
      }
    }
    refresh()
  }

  private func topLevelMenuItem(title: String, submenu: NSMenu) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func makeItem(from spec: SupatermMenuItemSpec) -> NSMenuItem {
    let item = NSMenuItem(title: spec.title, action: spec.action, keyEquivalent: "")
    item.identifier = spec.id
    if spec.targetsController {
      item.target = self
    }
    if let symbol = spec.symbol {
      item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: spec.title)
    }
    if let slot = spec.slot {
      item.representedObject = slot as NSNumber
    }
    switch spec.shortcut {
    case .fixed(let shortcut), .fixedRouted(let shortcut):
      SupatermMenuShortcut.apply(shortcut, to: item)
    case .none:
      SupatermMenuShortcut.apply(nil, to: item)
    case .command, .ghosttyAction:
      break
    }
    return item
  }

  private func systemItem(
    title: String,
    action: Selector,
    keyEquivalent: String = ""
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
    if !keyEquivalent.isEmpty {
      item.keyEquivalentModifierMask = .command
    }
    return item
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

extension SupatermMenuController: NSMenuItemValidation {
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let context = registry.menuContext()

    switch item.identifier {
    case MenuItemIdentifier.checkForUpdates:
      item.title = context.updateMenuItemText
      return context.isUpdateMenuItemEnabled
    case MenuItemIdentifier.newTab:
      return context.availability.hasWindow
    case MenuItemIdentifier.newTabInGroup:
      return context.hasSelectedGroup
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

enum SupatermMenuShortcut {
  static func apply(_ shortcut: KeyboardShortcut?, to item: NSMenuItem) {
    guard let shortcut else {
      item.keyEquivalent = ""
      item.keyEquivalentModifierMask = []
      return
    }

    item.keyEquivalent = shortcut.key.character.description
    item.keyEquivalentModifierMask = NSEvent.ModifierFlags(swiftUIFlags: shortcut.modifiers)
  }
}

extension NSEvent.ModifierFlags {
  fileprivate init(swiftUIFlags: EventModifiers) {
    var result: NSEvent.ModifierFlags = []
    if swiftUIFlags.contains(.shift) { result.insert(.shift) }
    if swiftUIFlags.contains(.control) { result.insert(.control) }
    if swiftUIFlags.contains(.option) { result.insert(.option) }
    if swiftUIFlags.contains(.command) { result.insert(.command) }
    if swiftUIFlags.contains(.capsLock) { result.insert(.capsLock) }
    self = result
  }
}
