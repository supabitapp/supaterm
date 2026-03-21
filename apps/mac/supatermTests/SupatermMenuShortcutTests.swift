import AppKit
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct SupatermMenuShortcutTests {
  @Test
  func applyAssignsKeyEquivalentAndModifiers() {
    let item = NSMenuItem(title: "Close", action: nil, keyEquivalent: "")

    SupatermMenuShortcut.apply(
      KeyboardShortcut("w", modifiers: [.command, .shift]),
      to: item
    )

    #expect(item.keyEquivalent == "w")
    #expect(item.keyEquivalentModifierMask == [.command, .shift])
  }

  @Test
  func applyClearsKeyEquivalentWhenShortcutIsMissing() {
    let item = NSMenuItem(title: "Close", action: nil, keyEquivalent: "w")
    item.keyEquivalentModifierMask = [.command]

    SupatermMenuShortcut.apply(nil, to: item)

    #expect(item.keyEquivalent.isEmpty)
    #expect(item.keyEquivalentModifierMask.isEmpty)
  }
}
