import AppKit
import SupatermTerminalModels
import SwiftUI

struct SupatermMenuItemSpec {
  enum ShortcutSource {
    case command(SupatermCommand)
    case ghosttyAction(String, defaultShortcut: KeyboardShortcut?)
    case fixed(KeyboardShortcut)
    case fixedRouted(KeyboardShortcut)
    case none
  }

  let id: NSUserInterfaceItemIdentifier?
  let title: String
  let action: Selector
  let symbol: String?
  let shortcut: ShortcutSource
  let slot: Int?
  let targetsController: Bool

  init(
    id: NSUserInterfaceItemIdentifier? = nil,
    title: String,
    action: Selector,
    symbol: String? = nil,
    shortcut: ShortcutSource = .none,
    slot: Int? = nil,
    targetsController: Bool = true
  ) {
    self.id = id
    self.title = title
    self.action = action
    self.symbol = symbol
    self.shortcut = shortcut
    self.slot = slot
    self.targetsController = targetsController
  }
}

enum SupatermMenuEntrySpec {
  case item(NSUserInterfaceItemIdentifier)
  case separator
  case system(
    title: String,
    action: Selector,
    keyEquivalent: String,
    modifiers: NSEvent.ModifierFlags?
  )
  case submenu(title: String, entries: [SupatermMenuEntrySpec])
  case services(title: String)
  case slots(prefix: String)
}

struct SupatermMenuSectionSpec {
  let title: String
  let entries: [SupatermMenuEntrySpec]
}
