import AppKit
import SwiftUI

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
  init(swiftUIFlags: EventModifiers) {
    var result: NSEvent.ModifierFlags = []
    if swiftUIFlags.contains(.shift) { result.insert(.shift) }
    if swiftUIFlags.contains(.control) { result.insert(.control) }
    if swiftUIFlags.contains(.option) { result.insert(.option) }
    if swiftUIFlags.contains(.command) { result.insert(.command) }
    if swiftUIFlags.contains(.capsLock) { result.insert(.capsLock) }
    self = result
  }
}
