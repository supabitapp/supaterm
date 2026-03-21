import AppKit
import SwiftUI

@MainActor
final class SupatermMenuController: NSObject {
  private enum MenuItemIdentifier {
    static let checkForUpdates = NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.checkForUpdates")
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
    static let find = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.find")
    static let findNext = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findNext")
    static let findPrevious = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.findPrevious")
    static let hideFindBar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.hideFindBar")
    static let selectionForFind = NSUserInterfaceItemIdentifier("app.supabit.supaterm.edit.selectionForFind")
    static let toggleSidebar = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.toggleSidebar")
    static let equalizePanes = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.equalizePanes")
    static let togglePaneZoom = NSUserInterfaceItemIdentifier("app.supabit.supaterm.view.togglePaneZoom")
    static let nextTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.next")
    static let previousTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.previous")
    static let selectLastTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.tabs.last")
    static let selectTabPrefix = "app.supabit.supaterm.tabs.select."
    static let selectWorkspacePrefix = "app.supabit.supaterm.spaces.select."
  }

  private let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  private var requestNewWindow: @MainActor () -> Bool = { false }

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
    menu.addItem(
      systemItem(title: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
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
    menu.addItem(
      systemItem(title: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    return menu
  }()

  private lazy var fileMenu: NSMenu = {
    let menu = NSMenu(title: "File")
    menu.addItem(newWindowItem)
    menu.addItem(newTabItem)
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
    menu.addItem(systemItem(title: "Undo", action: Selector(("undo:"))))
    menu.addItem(systemItem(title: "Redo", action: Selector(("redo:"))))
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
    menu.addItem(equalizePanesItem)
    menu.addItem(togglePaneZoomItem)
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
    for item in selectWorkspaceItems {
      menu.addItem(item)
    }
    return menu
  }()

  private lazy var windowMenu: NSMenu = {
    let menu = NSMenu(title: "Window")
    menu.addItem(systemItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
    menu.addItem(systemItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:))))
    menu.addItem(.separator())
    menu.addItem(systemItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:))))
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
  private lazy var newWindowItem = makeItem(
    title: "New Window",
    action: #selector(newWindow(_:)),
    identifier: MenuItemIdentifier.newWindow
  )
  private lazy var newTabItem = makeItem(
    title: "New Tab",
    action: #selector(newTab(_:)),
    identifier: MenuItemIdentifier.newTab
  )
  private lazy var splitRightItem = makeItem(
    title: "Split Right",
    action: #selector(splitRight(_:)),
    identifier: MenuItemIdentifier.splitRight
  )
  private lazy var splitLeftItem = makeItem(
    title: "Split Left",
    action: #selector(splitLeft(_:)),
    identifier: MenuItemIdentifier.splitLeft
  )
  private lazy var splitDownItem = makeItem(
    title: "Split Down",
    action: #selector(splitDown(_:)),
    identifier: MenuItemIdentifier.splitDown
  )
  private lazy var splitUpItem = makeItem(
    title: "Split Up",
    action: #selector(splitUp(_:)),
    identifier: MenuItemIdentifier.splitUp
  )
  private lazy var closeSurfaceItem = makeItem(
    title: "Close",
    action: #selector(closeSurface(_:)),
    identifier: MenuItemIdentifier.closeSurface
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
  private lazy var equalizePanesItem = makeItem(
    title: "Equalize Panes",
    action: #selector(equalizePanes(_:)),
    identifier: MenuItemIdentifier.equalizePanes
  )
  private lazy var togglePaneZoomItem = makeItem(
    title: "Toggle Pane Zoom",
    action: #selector(togglePaneZoom(_:)),
    identifier: MenuItemIdentifier.togglePaneZoom
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
  private lazy var selectTabItems: [NSMenuItem] = (1...8).map { slot in
    let item = makeItem(
      title: "Tab \(slot)",
      action: #selector(selectTab(_:)),
      identifier: .init(MenuItemIdentifier.selectTabPrefix + "\(slot)")
    )
    item.representedObject = slot as NSNumber
    return item
  }
  private lazy var selectWorkspaceItems: [NSMenuItem] = (1...10).map { slot in
    let item = makeItem(
      title: "Space \(slot)",
      action: #selector(selectWorkspace(_:)),
      identifier: .init(MenuItemIdentifier.selectWorkspacePrefix + "\(slot)")
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

    syncShortcut(command: .newWindow, item: newWindowItem)
    syncShortcut(command: .newTab, item: newTabItem)
    syncShortcut(command: .newSplit(.right), item: splitRightItem)
    syncShortcut(command: .newSplit(.left), item: splitLeftItem)
    syncShortcut(command: .newSplit(.down), item: splitDownItem)
    syncShortcut(command: .newSplit(.top), item: splitUpItem)
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
    syncShortcut(command: .equalizeSplits, item: equalizePanesItem)
    syncShortcut(command: .toggleSplitZoom, item: togglePaneZoomItem)
    syncShortcut(command: .nextTab, item: nextTabItem)
    syncShortcut(command: .previousTab, item: previousTabItem)
    for (offset, item) in selectTabItems.enumerated() {
      syncShortcut(command: .goToTab(offset + 1), item: item)
    }
    syncShortcut(command: .lastTab, item: selectLastTabItem)
    mainMenu.update()
  }

  @discardableResult
  func performNewWindow() -> Bool {
    requestNewWindow()
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    registry.requestCloseAllWindows()
  }

  @objc func checkForUpdates(_ sender: Any?) {
    registry.requestCheckForUpdatesInKeyWindow()
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
    registry.requestBindingActionInKeyWindow(.newSplit(.top))
  }

  @objc func closeSurface(_ sender: Any?) {
    registry.requestCloseSurfaceInKeyWindow()
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

  @objc func equalizePanes(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.equalizeSplits)
  }

  @objc func togglePaneZoom(_ sender: Any?) {
    registry.requestBindingActionInKeyWindow(.toggleSplitZoom)
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

  @objc func selectWorkspace(_ sender: Any?) {
    guard let slot = (sender as? NSMenuItem)?.representedObject as? NSNumber else { return }
    registry.requestSelectWorkspaceInKeyWindow(slot.intValue)
  }

  private func syncShortcut(command: SupatermCommand, item: NSMenuItem?) {
    guard let item else { return }
    if let shortcut = registry.keyboardShortcut(for: command) {
      SupatermMenuShortcut.apply(shortcut, to: item)
      return
    }
    if registry.hasShortcutSource {
      SupatermMenuShortcut.apply(nil, to: item)
      return
    }
    SupatermMenuShortcut.apply(command.defaultKeyboardShortcut, to: item)
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
    identifier: NSUserInterfaceItemIdentifier
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.identifier = identifier
    item.target = self
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
}

extension SupatermMenuController: NSMenuItemValidation {
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let context = registry.menuContext()

    switch item.identifier {
    case MenuItemIdentifier.checkForUpdates:
      item.title = context.updateMenuItemText
      return context.canCheckForUpdates
    case MenuItemIdentifier.newTab:
      return context.availability.hasWindow
    case MenuItemIdentifier.splitRight,
      MenuItemIdentifier.splitLeft,
      MenuItemIdentifier.splitDown,
      MenuItemIdentifier.splitUp:
      return context.availability.hasSurface
    case MenuItemIdentifier.closeSurface:
      return context.availability.hasSurface
    case MenuItemIdentifier.closeTab:
      return context.availability.hasTab
    case MenuItemIdentifier.closeWindow,
      MenuItemIdentifier.closeAllWindows,
      MenuItemIdentifier.toggleSidebar:
      return context.availability.hasWindow
    case MenuItemIdentifier.find,
      MenuItemIdentifier.findNext,
      MenuItemIdentifier.findPrevious,
      MenuItemIdentifier.selectionForFind,
      MenuItemIdentifier.equalizePanes,
      MenuItemIdentifier.togglePaneZoom:
      return context.availability.hasSurface
    case MenuItemIdentifier.hideFindBar:
      return context.hasSearch
    case MenuItemIdentifier.nextTab,
      MenuItemIdentifier.previousTab,
      MenuItemIdentifier.selectLastTab:
      return context.visibleTabCount > 0
    default:
      guard let identifier = item.identifier?.rawValue else { return true }
      if let slot = Int(identifier.replacingOccurrences(of: MenuItemIdentifier.selectTabPrefix, with: "")),
        identifier.hasPrefix(MenuItemIdentifier.selectTabPrefix)
      {
        return context.visibleTabCount >= slot
      }
      if let slot = Int(identifier.replacingOccurrences(of: MenuItemIdentifier.selectWorkspacePrefix, with: "")),
        identifier.hasPrefix(MenuItemIdentifier.selectWorkspacePrefix)
      {
        return context.workspaceCount >= slot
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
