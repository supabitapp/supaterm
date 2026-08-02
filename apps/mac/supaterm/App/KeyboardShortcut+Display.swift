import SwiftUI

extension KeyboardShortcut {
  var normalizedForAppKit: KeyboardShortcut {
    let rawKey = key.character
    guard let normalizedKey = rawKey.lowercased().first else { return self }
    let normalizedModifiers = normalizedKey == rawKey ? modifiers : modifiers.union(.shift)
    return KeyboardShortcut(KeyEquivalent(normalizedKey), modifiers: normalizedModifiers)
  }

  var display: String {
    let shortcut = normalizedForAppKit
    var parts: [String] = []
    if shortcut.modifiers.contains(.command) { parts.append("⌘") }
    if shortcut.modifiers.contains(.shift) { parts.append("⇧") }
    if shortcut.modifiers.contains(.option) { parts.append("⌥") }
    if shortcut.modifiers.contains(.control) { parts.append("⌃") }
    parts.append(shortcut.key.display)
    return parts.joined()
  }
}

extension KeyEquivalent {
  var display: String {
    switch self {
    case .delete:
      "⌫"
    case .deleteForward:
      "⌦"
    case .return:
      "↩"
    case .escape:
      "Esc"
    case .tab:
      "⇥"
    case .space:
      "Space"
    case .upArrow:
      "↑"
    case .downArrow:
      "↓"
    case .leftArrow:
      "←"
    case .rightArrow:
      "→"
    case .home:
      "↖"
    case .end:
      "↘"
    case .pageUp:
      "⇞"
    case .pageDown:
      "⇟"
    default:
      String(character).uppercased()
    }
  }
}
