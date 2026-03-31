import SwiftUI

extension KeyboardShortcut {
  var display: String {
    var parts: [String] = []
    if modifiers.contains(.command) { parts.append("⌘") }
    if modifiers.contains(.shift) { parts.append("⇧") }
    if modifiers.contains(.option) { parts.append("⌥") }
    if modifiers.contains(.control) { parts.append("⌃") }
    parts.append(key.display)
    return parts.joined()
  }
}

extension KeyEquivalent {
  var display: String {
    switch self {
    case .delete:
      "⌫"
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
