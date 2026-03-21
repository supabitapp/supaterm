import AppKit
import SwiftUI

@MainActor
final class SupatermMenuController: NSObject {
  private enum MenuItemTag {
    static let newTab = 5_100
    static let closeSurface = 5_101
    static let closeTab = 5_102
    static let closeAllWindows = 5_103
  }

  private let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  private var isInstalled = false

  private weak var fileMenu: NSMenu?
  private weak var newWindowItem: NSMenuItem?
  private weak var newTabItem: NSMenuItem?
  private weak var closeSurfaceItem: NSMenuItem?
  private weak var closeTabItem: NSMenuItem?
  private weak var closeWindowItem: NSMenuItem?
  private weak var closeAllWindowsItem: NSMenuItem?

  init(registry: TerminalWindowRegistry) {
    self.registry = registry
  }

  func install() {
    installObservers()
    guard !isInstalled else {
      refresh()
      return
    }
    guard
      let fileMenu = Self.fileMenu(),
      let newWindowItem = Self.newWindowItem(in: fileMenu),
      let closeWindowItem = Self.closeWindowItem(in: fileMenu)
    else {
      return
    }

    self.fileMenu = fileMenu
    self.newWindowItem = newWindowItem
    self.closeWindowItem = closeWindowItem

    newWindowItem.title = "New Window"
    closeWindowItem.title = "Close Window"

    let newTabItem = NSMenuItem(title: "New Tab", action: #selector(newTab(_:)), keyEquivalent: "")
    newTabItem.target = self
    newTabItem.tag = MenuItemTag.newTab
    fileMenu.insertItem(newTabItem, at: fileMenu.index(of: newWindowItem) + 1)
    self.newTabItem = newTabItem

    let closeSurfaceItem = NSMenuItem(title: "Close", action: #selector(closeSurface(_:)), keyEquivalent: "")
    closeSurfaceItem.target = self
    closeSurfaceItem.tag = MenuItemTag.closeSurface
    fileMenu.insertItem(closeSurfaceItem, at: fileMenu.index(of: closeWindowItem))
    self.closeSurfaceItem = closeSurfaceItem

    let closeTabItem = NSMenuItem(title: "Close Tab", action: #selector(closeTab(_:)), keyEquivalent: "")
    closeTabItem.target = self
    closeTabItem.tag = MenuItemTag.closeTab
    fileMenu.insertItem(closeTabItem, at: fileMenu.index(of: closeWindowItem))
    self.closeTabItem = closeTabItem

    let closeAllWindowsItem = NSMenuItem(
      title: "Close All Windows",
      action: #selector(closeAllWindows(_:)),
      keyEquivalent: ""
    )
    closeAllWindowsItem.target = self
    closeAllWindowsItem.tag = MenuItemTag.closeAllWindows
    fileMenu.insertItem(closeAllWindowsItem, at: fileMenu.index(of: closeWindowItem) + 1)
    self.closeAllWindowsItem = closeAllWindowsItem

    isInstalled = true
    refresh()
  }

  func refresh() {
    guard isInstalled else {
      install()
      return
    }
    syncShortcut(command: .newWindow, item: newWindowItem)
    syncShortcut(command: .newTab, item: newTabItem)
    syncShortcut(command: .closeSurface, item: closeSurfaceItem)
    syncShortcut(command: .closeTab, item: closeTabItem)
    syncShortcut(command: .closeWindow, item: closeWindowItem)
    syncShortcut(command: .closeAllWindows, item: closeAllWindowsItem)
    fileMenu?.update()
  }

  @discardableResult
  func performNewWindow() -> Bool {
    guard let newWindowItem, let action = newWindowItem.action else { return false }
    return NSApp.sendAction(action, to: newWindowItem.target, from: newWindowItem)
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    registry.requestCloseAllWindows()
  }

  @objc func newTab(_ sender: Any?) {
    registry.requestNewTabInKeyWindow()
  }

  @objc func closeSurface(_ sender: Any?) {
    registry.requestCloseSurfaceInKeyWindow()
  }

  @objc func closeTab(_ sender: Any?) {
    registry.requestCloseTabInKeyWindow()
  }

  @objc func closeAllWindows(_ sender: Any?) {
    _ = registry.requestCloseAllWindows()
  }

  private func syncShortcut(command: SupatermCommand, item: NSMenuItem?) {
    guard let item else { return }
    if let shortcut = registry.keyboardShortcut(for: command) {
      SupatermMenuShortcut.apply(shortcut, to: item)
      return
    }
    guard registry.hasShortcutSource else { return }
    SupatermMenuShortcut.apply(nil, to: item)
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

  private static func fileMenu() -> NSMenu? {
    NSApp.mainMenu?.items.first(where: { $0.title == "File" })?.submenu
  }

  private static func newWindowItem(in fileMenu: NSMenu) -> NSMenuItem? {
    fileMenu.items.first { item in
      !item.isSeparatorItem && item.title.hasPrefix("New ")
    }
  }

  private static func closeWindowItem(in fileMenu: NSMenu) -> NSMenuItem? {
    fileMenu.items.first { item in
      item.action == #selector(NSWindow.performClose(_:))
    }
  }
}

extension SupatermMenuController: NSMenuItemValidation {
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let availability = registry.commandAvailability()

    switch item.tag {
    case MenuItemTag.newTab:
      return availability.hasWindow
    case MenuItemTag.closeSurface:
      return availability.hasSurface
    case MenuItemTag.closeTab:
      return availability.hasTab
    case MenuItemTag.closeAllWindows:
      return availability.hasWindow
    default:
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
