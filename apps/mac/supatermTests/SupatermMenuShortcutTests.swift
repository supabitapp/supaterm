import AppKit
import Carbon.HIToolbox
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
  func applyPreservesUppercaseShortcutWithShift() {
    let item = NSMenuItem(title: "Open", action: nil, keyEquivalent: "")

    SupatermMenuShortcut.apply(
      KeyboardShortcut("Ä", modifiers: [.command]),
      to: item
    )

    #expect(item.keyEquivalent == "ä")
    #expect(item.keyEquivalentModifierMask == [.command, .shift])
  }

  @Test
  func applyDisablesAutomaticTranslationForPhysicalShortcut() {
    let item = NSMenuItem(title: "Open", action: nil, keyEquivalent: "")

    SupatermMenuShortcut.apply(
      KeyboardShortcut("q", modifiers: .command),
      physicalKeyCode: UInt16(kVK_ANSI_A),
      to: item
    )

    #expect(!item.allowsAutomaticKeyEquivalentLocalization)
    #expect(!item.allowsAutomaticKeyEquivalentMirroring)

    SupatermMenuShortcut.apply(
      KeyboardShortcut("q", modifiers: .command),
      to: item
    )

    #expect(item.allowsAutomaticKeyEquivalentLocalization)
    #expect(item.allowsAutomaticKeyEquivalentMirroring)
  }

  @Test
  func displayUsesNormalizedShortcut() {
    let shortcut = KeyboardShortcut("Ä", modifiers: [.command])

    #expect(shortcut.display == "⌘⇧Ä")
  }

  @Test
  func displayDistinguishesForwardDeleteFromBackspace() {
    #expect(KeyboardShortcut(.deleteForward, modifiers: []).display == "⌦")
    #expect(KeyboardShortcut(.delete, modifiers: []).display == "⌫")
  }

  @Test
  func applyClearsKeyEquivalentWhenShortcutIsMissing() {
    let item = NSMenuItem(title: "Close", action: nil, keyEquivalent: "w")
    SupatermMenuShortcut.apply(
      KeyboardShortcut("w", modifiers: .command),
      physicalKeyCode: UInt16(kVK_ANSI_W),
      to: item
    )

    SupatermMenuShortcut.apply(nil, to: item)

    #expect(item.keyEquivalent.isEmpty)
    #expect(item.keyEquivalentModifierMask.isEmpty)
    #expect(item.allowsAutomaticKeyEquivalentLocalization)
    #expect(item.allowsAutomaticKeyEquivalentMirroring)
  }
}
