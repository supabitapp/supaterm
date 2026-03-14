import SwiftUI

struct AppShortcut {
  let keyEquivalent: KeyEquivalent
  let modifiers: EventModifiers
  private let ghosttyKeyName: String

  init(key: Character, modifiers: EventModifiers) {
    self.keyEquivalent = KeyEquivalent(key)
    self.modifiers = modifiers
    self.ghosttyKeyName = String(key).lowercased()
  }

  init(keyEquivalent: KeyEquivalent, ghosttyKeyName: String, modifiers: EventModifiers) {
    self.keyEquivalent = keyEquivalent
    self.modifiers = modifiers
    self.ghosttyKeyName = ghosttyKeyName
  }

  var keyboardShortcut: KeyboardShortcut {
    KeyboardShortcut(keyEquivalent, modifiers: modifiers)
  }

  var ghosttyUnbindArgument: String {
    "--keybind=\(ghosttyKeybind)=unbind"
  }

  private var ghosttyKeybind: String {
    let parts = ghosttyModifierParts + [ghosttyKeyName]
    return parts.joined(separator: "+")
  }

  private var ghosttyModifierParts: [String] {
    var parts: [String] = []
    if modifiers.contains(.control) { parts.append("ctrl") }
    if modifiers.contains(.option) { parts.append("alt") }
    if modifiers.contains(.shift) { parts.append("shift") }
    if modifiers.contains(.command) { parts.append("super") }
    return parts
  }
}

enum AppShortcuts {
  private struct TabSelectionBinding {
    let unicode: String
    let physical: String
  }

  private static let tabSelectionBindings: [TabSelectionBinding] = [
    .init(unicode: "1", physical: "digit_1"),
    .init(unicode: "2", physical: "digit_2"),
    .init(unicode: "3", physical: "digit_3"),
    .init(unicode: "4", physical: "digit_4"),
    .init(unicode: "5", physical: "digit_5"),
    .init(unicode: "6", physical: "digit_6"),
    .init(unicode: "7", physical: "digit_7"),
    .init(unicode: "8", physical: "digit_8"),
    .init(unicode: "9", physical: "digit_9"),
    .init(unicode: "0", physical: "digit_0"),
  ]

  static let closeTab = AppShortcut(key: "w", modifiers: .command)
  static let newTab = AppShortcut(key: "t", modifiers: .command)
  static let nextTab = AppShortcut(key: "]", modifiers: [.command, .shift])
  static let previousTab = AppShortcut(key: "[", modifiers: [.command, .shift])

  static let all: [AppShortcut] = [
    closeTab,
    newTab,
    nextTab,
    previousTab,
  ]

  static var ghosttyCLIKeybindArguments: [String] {
    let tabSelectionUnbinds = tabSelectionBindings.flatMap { binding in
      [
        "--keybind=super+\(binding.unicode)=unbind",
        "--keybind=super+\(binding.physical)=unbind",
      ]
    }
    return all.map(\.ghosttyUnbindArgument) + tabSelectionUnbinds
  }
}
