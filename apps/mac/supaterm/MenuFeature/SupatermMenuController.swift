import AppKit
import SupatermAppFeature
import SupatermGhosttyFeature
import SupatermSettingsFeature
import SupatermSupport
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

@MainActor
public final class SupatermMenuController: NSObject {
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

  let registry: TerminalWindowRegistry
  private var observers: [NSObjectProtocol] = []
  var requestNewWindow: @MainActor () -> Bool = { false }
  var requestShowSettings: @MainActor (SettingsFeature.Tab) -> Bool = { _ in false }
  var requestSubmitGitHubIssue: @MainActor () -> Bool = {
    ExternalNavigationClient.liveValue.open(SupatermExternalURL.submitGitHubIssue)
  }
  private var ghosttyBindingItems: [GhosttyBindingMenuItem] = []

  var appName: String {
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

  public init(registry: TerminalWindowRegistry) {
    self.registry = registry
  }

  public func setNewWindowAction(_ action: @escaping @MainActor () -> Bool) {
    requestNewWindow = action
  }

  public func setShowSettingsAction(_ action: @escaping @MainActor (SettingsFeature.Tab) -> Bool) {
    requestShowSettings = action
  }

  func setSubmitGitHubIssueAction(_ action: @escaping @MainActor () -> Bool) {
    requestSubmitGitHubIssue = action
  }

  public func install() {
    installObservers()
    NSApp.mainMenu = mainMenu
    NSApp.servicesMenu = servicesMenu
    NSApp.windowsMenu = windowMenu
    NSApp.helpMenu = helpMenu
    refresh()
  }

  public func refresh() {
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
  public func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
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
      GhosttyBindingMenuItem(
        shortcut: MenuShortcutKey(shortcut: shortcut),
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

}
