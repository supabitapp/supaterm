import AppKit
import SwiftUI

@MainActor
final class SupatermMenuController: NSObject {
  private enum MenuItemIdentifier {
    static let newWindow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newWindow")
    static let newTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.newTab")
    static let sectionSeparator = NSUserInterfaceItemIdentifier(
      "app.supabit.supaterm.file.sectionSeparator"
    )
    static let closeSurface = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.close")
    static let closeTab = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.closeTab")
    static let closeWindow = NSUserInterfaceItemIdentifier("app.supabit.supaterm.file.closeWindow")
    static let closeAllWindows = NSUserInterfaceItemIdentifier(
      "app.supabit.supaterm.file.closeAllWindows"
    )

    static let owned: Set<NSUserInterfaceItemIdentifier> = [
      newWindow,
      newTab,
      sectionSeparator,
      closeSurface,
      closeTab,
      closeWindow,
      closeAllWindows,
    ]
  }

  private let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  private var requestNewWindow: @MainActor () -> Bool = { false }
  private weak var fileMenu: NSMenu?

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
  private lazy var sectionSeparatorItem = makeSeparator(identifier: MenuItemIdentifier.sectionSeparator)
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

  init(registry: TerminalWindowRegistry) {
    self.registry = registry
  }

  func setNewWindowAction(_ action: @escaping @MainActor () -> Bool) {
    requestNewWindow = action
  }

  func install() {
    installObservers()
    refresh()
  }

  func refresh() {
    guard let fileMenu = Self.fileMenu() else { return }
    self.fileMenu = fileMenu
    ensureOwnedFileItems(in: fileMenu)
    syncShortcut(command: .newWindow, item: newWindowItem)
    syncShortcut(command: .newTab, item: newTabItem)
    syncShortcut(command: .closeSurface, item: closeSurfaceItem)
    syncShortcut(command: .closeTab, item: closeTabItem)
    syncShortcut(command: .closeWindow, item: closeWindowItem)
    syncShortcut(command: .closeAllWindows, item: closeAllWindowsItem)
    fileMenu.update()
  }

  @discardableResult
  func performNewWindow() -> Bool {
    requestNewWindow()
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    registry.requestCloseAllWindows()
  }

  @objc func newTab(_ sender: Any?) {
    registry.requestNewTabInKeyWindow()
  }

  @objc func newWindow(_ sender: Any?) {
    _ = performNewWindow()
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
    SupatermMenuShortcut.apply(Self.defaultShortcut(for: command), to: item)
  }

  private func ensureOwnedFileItems(in fileMenu: NSMenu) {
    let ownedItems = ownedFileItems()
    let insertionIndex = Self.insertionIndex(in: fileMenu)

    Self.removeOwnedItems(from: fileMenu)
    Self.removeBuiltInOverlapItems(from: fileMenu)
    Self.removeRedundantSeparators(from: fileMenu)

    for (offset, item) in ownedItems.enumerated() {
      fileMenu.insertItem(item, at: insertionIndex + offset)
    }
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

  private func ownedFileItems() -> [NSMenuItem] {
    [
      newWindowItem,
      newTabItem,
      sectionSeparatorItem,
      closeSurfaceItem,
      closeTabItem,
      closeWindowItem,
      closeAllWindowsItem,
    ]
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

  private func makeSeparator(identifier: NSUserInterfaceItemIdentifier) -> NSMenuItem {
    let item = NSMenuItem.separator()
    item.identifier = identifier
    return item
  }

  private static func insertionIndex(in fileMenu: NSMenu) -> Int {
    if let currentOwnedIndex = fileMenu.items.firstIndex(where: isOwnedItem(_:)) {
      return currentOwnedIndex
    }

    return builtInOverlapIndices(in: fileMenu).min() ?? 0
  }

  private static func removeOwnedItems(from fileMenu: NSMenu) {
    for index in fileMenu.items.indices.reversed() where isOwnedItem(fileMenu.items[index]) {
      fileMenu.removeItem(at: index)
    }
  }

  private static func removeBuiltInOverlapItems(from fileMenu: NSMenu) {
    for index in builtInOverlapIndices(in: fileMenu).sorted(by: >) {
      fileMenu.removeItem(at: index)
    }
  }

  private static func builtInOverlapIndices(in fileMenu: NSMenu) -> [Int] {
    fileMenu.items.indices.filter { index in
      isBuiltInOverlapItem(fileMenu.items[index])
    }
  }

  private static func isBuiltInOverlapItem(_ item: NSMenuItem) -> Bool {
    guard !isOwnedItem(item), !item.isSeparatorItem else { return false }
    if isBuiltInNewWindowItem(item) {
      return true
    }
    if item.title == "Close" {
      return item.keyEquivalent.caseInsensitiveCompare("w") == .orderedSame
    }
    if item.title == "Close Window" {
      return item.keyEquivalent.caseInsensitiveCompare("w") == .orderedSame
        && normalizedModifiers(for: item).contains(.shift)
    }
    if item.title == "Close All Windows" {
      return item.keyEquivalent.caseInsensitiveCompare("w") == .orderedSame
        && normalizedModifiers(for: item).contains(.option)
        && normalizedModifiers(for: item).contains(.shift)
    }
    return false
  }

  private static func isBuiltInNewWindowItem(_ item: NSMenuItem) -> Bool {
    item.title.hasPrefix("New ")
      && item.title.hasSuffix(" Window")
      && item.keyEquivalent.caseInsensitiveCompare("n") == .orderedSame
      && normalizedModifiers(for: item) == .command
  }

  private static func normalizedModifiers(for item: NSMenuItem) -> NSEvent.ModifierFlags {
    item.keyEquivalentModifierMask.intersection(.deviceIndependentFlagsMask)
  }

  private static func removeRedundantSeparators(from fileMenu: NSMenu) {
    var previousWasSeparator = false
    for index in fileMenu.items.indices.reversed() {
      let item = fileMenu.items[index]
      if item.isSeparatorItem {
        if previousWasSeparator || index == 0 || index == fileMenu.items.count - 1 {
          fileMenu.removeItem(at: index)
          continue
        }
        previousWasSeparator = true
      } else {
        previousWasSeparator = false
      }
    }
  }

  private static func defaultShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    switch command {
    case .newWindow:
      KeyboardShortcut("n", modifiers: .command)
    case .newTab:
      KeyboardShortcut("t", modifiers: .command)
    case .closeSurface:
      KeyboardShortcut("w", modifiers: .command)
    case .closeTab:
      KeyboardShortcut("w", modifiers: [.command, .option])
    case .closeWindow:
      KeyboardShortcut("w", modifiers: [.command, .shift])
    case .closeAllWindows:
      KeyboardShortcut("w", modifiers: [.command, .option, .shift])
    default:
      nil
    }
  }

  private static func isOwnedItem(_ item: NSMenuItem) -> Bool {
    guard let identifier = item.identifier else { return false }
    return MenuItemIdentifier.owned.contains(identifier)
  }
}

extension SupatermMenuController: NSMenuItemValidation {
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    let availability = registry.commandAvailability()

    switch item.identifier {
    case MenuItemIdentifier.newTab:
      return availability.hasWindow
    case MenuItemIdentifier.closeSurface:
      return availability.hasSurface
    case MenuItemIdentifier.closeTab:
      return availability.hasTab
    case MenuItemIdentifier.closeWindow:
      return availability.hasWindow
    case MenuItemIdentifier.closeAllWindows:
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
