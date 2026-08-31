import Foundation
import SupatermSupport

struct ShortcutSearchMatcher {
  private static let aliases = [
    "command": "⌘",
    "cmd": "⌘",
    "option": "⌥",
    "alt": "⌥",
    "control": "⌃",
    "ctrl": "⌃",
    "shift": "⇧",
  ]

  private let nameQuery: String
  private let bindingQuery: String

  init(query: String) {
    nameQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    bindingQuery = Self.normalizedBindingQuery(query)
  }

  func matches(
    _ shortcut: SupatermShortcut,
    overrides: [SupatermShortcutID: SupatermShortcutOverride]
  ) -> Bool {
    guard !nameQuery.isEmpty else {
      return true
    }
    if shortcut.displayName.lowercased().contains(nameQuery) {
      return true
    }
    guard !bindingQuery.isEmpty, let binding = shortcut.effective(from: overrides) else {
      return false
    }
    return binding.display.lowercased().contains(bindingQuery)
  }

  private static func normalizedBindingQuery(_ query: String) -> String {
    query
      .lowercased()
      .split { $0.isWhitespace || $0 == "+" }
      .map { aliases[String($0)] ?? String($0) }
      .joined()
  }
}
