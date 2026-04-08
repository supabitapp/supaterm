import AppKit
import SwiftUI

@MainActor
final class SupatermMenuController: NSObject {
  private struct MenuShortcutKey: Equatable {
    let keyEquivalent: String
    let modifierMask: NSEvent.ModifierFlags

    init(shortcut: KeyboardShortcut) {
      self.keyEquivalent = shortcut.key.character.description.lowercased()
      self.modifierMask = .init(swiftUIFlags: shortcut.modifiers).intersection(.deviceIndependentFlagsMask)
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
    static let openCommandPalette = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.openCommandPalette")
    static let find = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.find")
    static let findNext = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findNext")
    static let findPrevious = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findPrevious")
    static let hideFindBar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.hideFindBar")
    static let selectionForFind = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.selectionForFind")
    static let toggleSidebar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.toggleSidebar")
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
  }

  private let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  private var requestNewWindow: @MainActor () -> Bool = { false }
  private var requestShowSettings: @MainActor (SettingsFeature.Tab) -> Bool = { _ in false }
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

  private lazy var mainMenu: NSMenu = {
    let menu = NSMenu(title: "Supaterm")
    menu.addItem(topLevelMenuItem(title: appName, submenu: appMenu))
    menu.addItem(topLevelMenuItem(title: "File", submenu: fileMenu))
    menu.addItem(topLevelMenuItem(title: "Edit", submenu: editMenu))
    menu.addItem(topLevelMenuItem(title: "View", submenu: viewMenu))
    menu.addItem(topLevelMenuItem(title: "Tabs", submenu: tabsMenu))
    menu.addItem(topLevelMenuItem(title: "Spaces", submenu: spacesMenu))
    menu.addItem(topLevelMenuItem(title: "Window", submenu: windowMenu))
    menu.addItem(topLevelMenuItem(title: "Help", submenu: helpMenu))
    return menu
  }()

  private lazy var appMenu: NSMenu = {
    let menu = NSMenu(title: appName)
    menu.addItem(aboutItem)
    menu.addItem(settingsItem)
    menu.addItem(.separator())
    menu.addItem(checkForUpdatesItem)
    menu.addItem(.separator())
    let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
    servicesItem.submenu = servicesMenu
    menu.addItem(servicesItem)
    menu.addItem(.separator())
    menu.addItem(systemItem(title: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
    let hideOthers = systemItem(
      title: "Hide Others",
      action: #selector(NSApplication.hideOtherApplications(_:)),
      keyEquivalent: "h"
    )
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    menu.addItem(hideOthers)
    menu.addItem(systemItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:))))
    menu.addItem(.separator())
    menu.addItem(quitItem)
    return menu
  }()

  private lazy var fileMenu: NSMenu = {
    let menu = NSMenu(title: "File")
    menu.addItem(newWindowItem)
    menu.addItem(newTabItem)
    menu.addItem(openCommandPaletteItem)
    menu.addItem(.separator())
    menu.addItem(splitRightItem)
    menu.addItem(splitLeftItem)
    menu.addItem(splitDownItem)
    menu.addItem(splitUpItem)
    menu.addItem(.separator())
    menu.addItem(closeSurfaceItem)
    menu.addItem(closeTabItem)
    menu.addItem(closeWindowItem)
    menu.addItem(closeAllWindowsItem)
    return menu
  }()

  private lazy var editMenu: NSMenu = {
    let menu = NSMenu(title: "Edit")
    menu.addItem(systemItem(title: "Undo", action: #selector(UndoManager.undo)))
    menu.addItem(systemItem(title: "Redo", action: #selector(UndoManager.redo)))
    menu.addItem(.separator())
    menu.addItem(copyItem)
    menu.addItem(pasteItem)
    menu.addItem(pasteSelectionItem)
    menu.addItem(selectAllItem)
    menu.addItem(.separator())
    let findMenuItem = NSMenuItem(title: "Find", action: nil, keyEquivalent: "")
    findMenuItem.submenu = findMenu
    menu.addItem(findMenuItem)
    return menu
  }()

  private lazy var findMenu: NSMenu = {
    let menu = NSMenu(title: "Find")
    menu.addItem(findItem)
    menu.addItem(findNextItem)
    menu.addItem(findPreviousItem)
    menu.addItem(.separator())
    menu.addItem(hideFindBarItem)
    menu.addItem(.separator())
    menu.addItem(selectionForFindItem)
    return menu
  }()

  private lazy var viewMenu: NSMenu = {
    let menu = NSMenu(title: "View")
    menu.addItem(toggleSidebarItem)
    menu.addItem(.separator())
    menu.addItem(changeTabTitleItem)
    menu.addItem(changeTerminalTitleItem)
    return menu
  }()

  private lazy var tabsMenu: NSMenu = {
    let menu = NSMenu(title: "Tabs")
    menu.addItem(nextTabItem)
    menu.addItem(previousTabItem)
    menu.addItem(.separator())
    for item in selectTabItems {
      menu.addItem(item)
    }
    menu.addItem(selectLastTabItem)
    return menu
  }()

  private lazy var spacesMenu: NSMenu = {
    let menu = NSMenu(title: "Spaces")
    for item in selectSpaceItems {
      menu.addItem(item)
    }
    return menu
  }()

  private lazy var windowMenu: NSMenu = {
    let menu = NSMenu(title: "Window")
    menu.addItem(systemItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
    menu.addItem(systemItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:))))
    menu.addItem(.separator())
    menu.addItem(zoomSplitItem)
    menu.addItem(previousSplitItem)
    menu.addItem(nextSplitItem)
    let selectSplitMenuItem = NSMenuItem(title: "Select Split", action: nil, keyEquivalent: "")
    selectSplitMenuItem.submenu = selectSplitMenu
    menu.addItem(selectSplitMenuItem)
    let resizeSplitMenuItem = NSMenuItem(title: "Resize Split", action: nil, keyEquivalent: "")
    resizeSplitMenuItem.submenu = resizeSplitMenu
    menu.addItem(resizeSplitMenuItem)
    menu.addItem(.separator())
    menu.addItem(systemItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:))))
    return menu
  }()

  private lazy var selectSplitMenu: NSMenu = {
    let menu = NSMenu(title: "Select Split")
    menu.addItem(selectSplitAboveItem)
    menu.addItem(selectSplitBelowItem)
    menu.addItem(selectSplitLeftItem)
    menu.addItem(selectSplitRightItem)
    return menu
  }()

  private lazy var resizeSplitMenu: NSMenu = {
    let menu = NSMenu(title: "Resize Split")
    menu.addItem(equalizeSplitsItem)
    menu.addItem(.separator())
    menu.addItem(moveSplitDividerUpItem)
    menu.addItem(moveSplitDividerDownItem)
    menu.addItem(moveSplitDividerLeftItem)
    menu.addItem(moveSplitDividerRightItem)
    return menu
  }()

  private lazy var helpMenu: NSMenu = {
    let menu = NSMenu(title: "Help")
    menu.addItem(
      systemItem(title: "\(appName) Help", action: #selector(NSApplication.showHelp(_:)), keyEquivalent: "?"))
    return menu
  }()

  private lazy var checkForUpdatesItem = makeItem(
    title: "Check for Updates...",
    action: #selector(checkForUpdates(_:)),
    identifier: MenuItemIdentifier.checkForUpdates
  )
  private lazy var aboutItem = makeItem(
    title: "About \(appName)",
    action: #selector(about(_:)),
    identifier: MenuItemIdentifier.about
  )
  private lazy var quitItem = makeItem(
    title: "Quit \(appName)",
    action: #selector(quit(_:)),
    identifier: MenuItemIdentifier.quit
  )
  private lazy var settingsItem: NSMenuItem = {
    let item = makeItem(
      title: "Settings...",
      action: #selector(showSettings(_:)),
      identifier: MenuItemIdentifier.settings
    )
    item.keyEquivalent = ","
    item.keyEquivalentModifierMask = .command
    return item
  }()
  private lazy var newWindowItem = makeItem(
    title: "New Window",
    action: #selector(newWindow(_:)),
    identifier: MenuItemIdentifier.newWindow,
    symbol: "macwindow.badge.plus"
  )
  private lazy var newTabItem = makeItem(
    title: "New Tab",
    action: #selector(newTab(_:)),
    identifier: MenuItemIdentifier.newTab,
    symbol: "macwindow"
  )
  private lazy var splitRightItem = makeItem(
    title: "Split Right",
    action: #selector(splitRight(_:)),
    identifier: MenuItemIdentifier.splitRight,
    symbol: "rectangle.righthalf.inset.filled"
  )
  private lazy var splitLeftItem = makeItem(
    title: "Split Left",
    action: #selector(splitLeft(_:)),
    identifier: MenuItemIdentifier.splitLeft,
    symbol: "rectangle.leadinghalf.inset.filled"
  )
  private lazy var splitDownItem = makeItem(
    title: "Split Down",
    action: #selector(splitDown(_:)),
    identifier: MenuItemIdentifier.splitDown,
    symbol: "rectangle.bottomhalf.inset.filled"
  )
  private lazy var splitUpItem = makeItem(
    title: "Split Up",
    action: #selector(splitUp(_:)),
    identifier: MenuItemIdentifier.splitUp,
    symbol: "rectangle.tophalf.inset.filled"
  )
  private lazy var closeSurfaceItem = makeItem(
    title: "Close",
    action: #selector(closeSurface(_:)),
    identifier: MenuItemIdentifier.closeSurface,
    symbol: "xmark"
  )
  private lazy var closeTabItem = makeItem(
    title: "Close Tab",
    action: #selector(closeTab(_:)),
    identifier: MenuItemIdentifier.closeTab
  )
  private lazy var closeWindowItem = makeItem(
    title: "Close Window",
    action: #selector(closeWindow(_:)),
    identifier: MenuItemIdentifier.closeWindow
  )
  private lazy var closeAllWindowsItem = makeItem(
    title: "Close All Windows",
    action: #selector(closeAllWindows(_:)),
    identifier: MenuItemIdentifier.closeAllWindows
  )
  private lazy var openCommandPaletteItem = makeItem(
    title: "Open Command Palette",
    action: #selector(openCommandPalette(_:)),
    identifier: MenuItemIdentifier.openCommandPalette,
    symbol: "magnifyingglass"
  )
  private lazy var findItem = makeItem(
    title: "Find...",
    action: #selector(find(_:)),
    identifier: MenuItemIdentifier.find
  )
  private lazy var findNextItem = makeItem(
    title: "Find Next",
    action: #selector(findNext(_:)),
    identifier: MenuItemIdentifier.findNext
  )
  private lazy var findPreviousItem = makeItem(
    title: "Find Previous",
    action: #selector(findPrevious(_:)),
    identifier: MenuItemIdentifier.findPrevious
  )
  private lazy var hideFindBarItem = makeItem(
    title: "Hide Find Bar",
    action: #selector(findHide(_:)),
    identifier: MenuItemIdentifier.hideFindBar
  )
  private lazy var selectionForFindItem = makeItem(
    title: "Use Selection for Find",
    action: #selector(selectionForFind(_:)),
    identifier: MenuItemIdentifier.selectionForFind
  )
  private lazy var copyItem = systemItem(title: "Copy", action: #selector(GhosttySurfaceView.copy(_:)))
  private lazy var pasteItem = systemItem(title: "Paste", action: #selector(GhosttySurfaceView.paste(_:)))
  private lazy var pasteSelectionItem = systemItem(
    title: "Paste Selection",
    action: #selector(GhosttySurfaceView.pasteSelection(_:))
  )
  private lazy var selectAllItem = systemItem(title: "Select All", action: #selector(GhosttySurfaceView.selectAll(_:)))
  private lazy var toggleSidebarItem: NSMenuItem = {
    let item = makeItem(
      title: "Toggle Sidebar",
      action: #selector(toggleSidebar(_:)),
      identifier: MenuItemIdentifier.toggleSidebar
    )
    SupatermMenuShortcut.apply(KeyboardShortcut("s", modifiers: .command), to: item)
    return item
  }()
  private lazy var changeTabTitleItem = makeItem(
    title: "Change Tab Title...",
    action: #selector(changeTabTitle(_:)),
    identifier: MenuItemIdentifier.changeTabTitle,
    symbol: "pencil.line"
  )
  private lazy var changeTerminalTitleItem = makeItem(
    title: "Change Terminal Title...",
    action: #selector(changeTerminalTitle(_:)),
    identifier: MenuItemIdentifier.changeTerminalTitle,
    symbol: "pencil.line"
  )
  private lazy var nextTabItem = makeItem(
    title: "Next Tab",
    action: #selector(nextTab(_:)),
    identifier: MenuItemIdentifier.nextTab
  )
  private lazy var previousTabItem = makeItem(
    title: "Previous Tab",
    action: #selector(previousTab(_:)),
    identifier: MenuItemIdentifier.previousTab
  )
  private lazy var selectLastTabItem = makeItem(
    title: "Last Tab",
    action: #selector(selectLastTab(_:)),
    identifier: MenuItemIdentifier.selectLastTab
  )
  private lazy var selectTabItems: [NSMenuItem] = (1...10).map { slot in
    let item = makeItem(
      title: "Tab \(slot)",
      action: #selector(selectTab(_:)),
      identifier: .init(MenuItemIdentifier.selectTabPrefix + "\(slot)")
    )
    item.representedObject = slot as NSNumber
    return item
  }
  private lazy var zoomSplitItem = makeItem(
    title: "Zoom Split",
    action: #selector(zoomSplit(_:)),
    identifier: MenuItemIdentifier.zoomSplit,
    symbol: "arrow.up.left.and.arrow.down.right"
  )
  private lazy var previousSplitItem = makeItem(
    title: "Select Previous Split",
    action: #selector(previousSplit(_:)),
    identifier: MenuItemIdentifier.previousSplit,
    symbol: "chevron.backward.2"
  )
  private lazy var nextSplitItem = makeItem(
    title: "Select Next Split",
    action: #selector(nextSplit(_:)),
    identifier: MenuItemIdentifier.nextSplit,
    symbol: "chevron.forward.2"
  )
  private lazy var selectSplitAboveItem = makeItem(
    title: "Select Split Above",
    action: #selector(selectSplitAbove(_:)),
    identifier: MenuItemIdentifier.selectSplitAbove,
    symbol: "arrow.up"
  )
  private lazy var selectSplitBelowItem = makeItem(
    title: "Select Split Below",
    action: #selector(selectSplitBelow(_:)),
    identifier: MenuItemIdentifier.selectSplitBelow,
    symbol: "arrow.down"
  )
  private lazy var selectSplitLeftItem = makeItem(
    title: "Select Split Left",
    action: #selector(selectSplitLeft(_:)),
    identifier: MenuItemIdentifier.selectSplitLeft,
    symbol: "arrow.left"
  )
  private lazy var selectSplitRightItem = makeItem(
    title: "Select Split Right",
    action: #selector(selectSplitRight(_:)),
    identifier: MenuItemIdentifier.selectSplitRight,
    symbol: "arrow.right"
  )
  private lazy var equalizeSplitsItem = makeItem(
    title: "Equalize Splits",
    action: #selector(equalizeSplits(_:)),
    identifier: MenuItemIdentifier.equalizeSplits,
    symbol: "inset.filled.topleft.topright.bottomleft.bottomright.rectangle"
  )
  private lazy var moveSplitDividerUpItem = makeItem(
    title: "Move Divider Up",
    action: #selector(moveSplitDividerUp(_:)),
    identifier: MenuItemIdentifier.moveSplitDividerUp,
    symbol: "arrow.up.to.line"
  )
  private lazy var moveSplitDividerDownItem = makeItem(
    title: "Move Divider Down",
    action: #selector(moveSplitDividerDown(_:)),
    identifier: MenuItemIdentifier.moveSplitDividerDown,
    symbol: "arrow.down.to.line"
  )
  private lazy var moveSplitDividerLeftItem = makeItem(
    title: "Move Divider Left",
    action: #selector(moveSplitDividerLeft(_:)),
    identifier: MenuItemIdentifier.moveSplitDividerLeft,
    symbol: "arrow.left.to.line"
  )
  private lazy var moveSplitDividerRightItem = makeItem(
    title: "Move Divider Right",
    action: #selector(moveSplitDividerRight(_:)),
    identifier: MenuItemIdentifier.moveSplitDividerRight,
    symbol: "arrow.right.to.line"
  )
  private lazy var selectSpaceItems: [NSMenuItem] = (1...10).map { slot in
    let item = makeItem(
      title: "Space \(slot)",
      action: #selector(selectSpace(_:)),
      identifier: .init(MenuItemIdentifier.selectSpacePrefix + "\(slot)")
    )
    let key = slot == 10 ? "0" : "\(slot)"
    SupatermMenuShortcut.apply(
      KeyboardShortcut(KeyEquivalent(Character(key)), modifiers: .control),
      to: item
    )
    item.representedObject = slot as NSNumber
    return item
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

  func install() {
    installObservers()
    NSApp.mainMenu = mainMenu
    NSApp.servicesMenu = servicesMenu
    NSApp.windowsMenu = windowMenu
    refresh()
  }

  func refresh() {
    if NSApp.mainMenu !== mainMenu {
      NSApp.mainMenu = mainMenu
      NSApp.servicesMenu = servicesMenu
      NSApp.windowsMenu = windowMenu
    }

    ghosttyBindingItems = []
    syncShortcut(
      action: "open_config",
      item: settingsItem,
      defaultShortcut: KeyboardShortcut(",", modifiers: .command)
    )
    syncShortcut(action: "check_for_updates", item: checkForUpdatesItem)
    syncShortcut(
      action: "quit",
      item: quitItem,
      defaultShortcut: KeyboardShortcut("q", modifiers: .command)
    )
    syncShortcut(command: .newWindow, item: newWindowItem)
    syncShortcut(command: .newTab, item: newTabItem)
    syncShortcut(
      action: "toggle_command_palette",
      item: openCommandPaletteItem,
      defaultShortcut: KeyboardShortcut("p", modifiers: [.command, .shift])
    )
    syncShortcut(command: .newSplit(.right), item: splitRightItem)
    syncShortcut(command: .newSplit(.left), item: splitLeftItem)
    syncShortcut(command: .newSplit(.down), item: splitDownItem)
    syncShortcut(command: .newSplit(.up), item: splitUpItem)
    syncShortcut(command: .closeSurface, item: closeSurfaceItem)
    syncShortcut(command: .closeTab, item: closeTabItem)
    syncShortcut(command: .closeWindow, item: closeWindowItem)
    syncShortcut(command: .closeAllWindows, item: closeAllWindowsItem)
    syncShortcut(command: .copyToClipboard, item: copyItem)
    syncShortcut(command: .pasteFromClipboard, item: pasteItem)
    syncShortcut(command: .pasteFromSelection, item: pasteSelectionItem)
    syncShortcut(command: .selectAll, item: selectAllItem)
    syncShortcut(command: .startSearch, item: findItem)
    syncShortcut(command: .navigateSearch(.next), item: findNextItem)
    syncShortcut(command: .navigateSearch(.previous), item: findPreviousItem)
    syncShortcut(command: .endSearch, item: hideFindBarItem)
    syncShortcut(command: .searchSelection, item: selectionForFindItem)
    syncShortcut(command: .promptTabTitle, item: changeTabTitleItem)
    syncShortcut(command: .promptSurfaceTitle, item: changeTerminalTitleItem)
    syncShortcut(command: .toggleSplitZoom, item: zoomSplitItem)
    syncShortcut(command: .goToSplit(.previous), item: previousSplitItem)
    syncShortcut(command: .goToSplit(.next), item: nextSplitItem)
    syncShortcut(command: .goToSplit(.up), item: selectSplitAboveItem)
    syncShortcut(command: .goToSplit(.down), item: selectSplitBelowItem)
    syncShortcut(command: .goToSplit(.left), item: selectSplitLeftItem)
    syncShortcut(command: .goToSplit(.right), item: selectSplitRightItem)
    syncShortcut(command: .equalizeSplits, item: equalizeSplitsItem)
    syncShortcut(command: .resizeSplit(.up, 10), item: moveSplitDividerUpItem)
    syncShortcut(command: .resizeSplit(.down, 10), item: moveSplitDividerDownItem)
    syncShortcut(command: .resizeSplit(.left, 10), item: moveSplitDividerLeftItem)
    syncShortcut(command: .resizeSplit(.right, 10), item: moveSplitDividerRightItem)
    syncShortcut(command: .nextTab, item: nextTabItem)
    syncShortcut(command: .previousTab, item: previousTabItem)
    for (offset, item) in selectTabItems.enumerated() {
      syncShortcut(command: .goToTab(offset + 1), item: item)
    }
    syncShortcut(command: .lastTab, item: selectLastTabItem)
    mainMenu.update()
  }

  @discardableResult
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
    let item =
      (ghosttyBindingItems
      .lazy
      .first { $0.shortcut.matches(event) })?.item
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
  func performCloseAllWindows() -> Bool {
    registry.requestCloseAllWindows()
  }

  @discardableResult
  func performQuit() -> Bool {
    if let performer = NSApp.delegate as? any GhosttyAppActionPerforming {
      return performer.performQuit()
    }
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

  @objc func openCommandPalette(_ sender: Any?) {
    registry.requestToggleCommandPaletteInKeyWindow()
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
      .init(
        shortcut: .init(shortcut: shortcut),
        item: item
      )
    )
  }

  private func installObservers() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: NSWindow.didBecomeKeyNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.refresh()
        }
      }
    )
    observers.append(
      center.addObserver(
        forName: NSWindow.didResignKeyNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.refresh()
        }
      }
    )
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

  private func topLevelMenuItem(title: String, submenu: NSMenu) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func makeItem(
    title: String,
    action: Selector,
    identifier: NSUserInterfaceItemIdentifier,
    symbol: String? = nil
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.identifier = identifier
    item.target = self
    if let symbol {
      item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
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
      keyWindow?.performClose(sender)
      return true
    }
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
}

enum SupatermMenuShortcut {
  static func apply(_ shortcut: KeyboardShortcut?, to item: NSMenuItem) {
    guard let shortcut else {
      item.keyEquivalent = ""
      item.keyEquivalentModifierMask = []
      return
    }

    item.keyEquivalent = shortcut.key.character.description
    item.keyEquivalentModifierMask = .init(swiftUIFlags: shortcut.modifiers)
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
