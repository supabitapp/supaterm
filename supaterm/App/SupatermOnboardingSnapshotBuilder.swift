import SupatermCLIShared
import SwiftUI

@MainActor
enum SupatermOnboardingSnapshotBuilder {
  static func snapshot(
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingSnapshot {
    let items = onboardingItems(shortcutForAction: shortcutForAction)
    let splitRightShortcut = items.first { $0.title == "Split right" }?.shortcut ?? "⌘D"
    let splitDownShortcut = items.first { $0.title == "Split down" }?.shortcut ?? "⌘⇧D"

    return .init(
      items: items,
      paneTips: [
        "Panes stay in the current tab.",
        "\(splitRightShortcut) splits right beside the current pane.",
        "\(splitDownShortcut) splits down below the current pane.",
      ]
    )
  }

  private static func onboardingItems(
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> [SupatermOnboardingShortcut] {
    curatedEntries.map { entry in
      .init(
        shortcut: resolvedShortcut(for: entry, shortcutForAction: shortcutForAction),
        title: entry.title
      )
    }
  }

  private static func resolvedShortcut(
    for entry: CuratedEntry,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> String {
    if let action = entry.action, let shortcut = format(shortcutForAction(action)) {
      return shortcut
    }
    return entry.fallbackShortcut
  }

  private static func format(_ shortcut: KeyboardShortcut?) -> String? {
    guard let shortcut else { return nil }
    return modifiers(shortcut.modifiers) + key(shortcut.key)
  }

  private static func modifiers(_ modifiers: EventModifiers) -> String {
    var value = ""
    if modifiers.contains(.command) {
      value += "⌘"
    }
    if modifiers.contains(.shift) {
      value += "⇧"
    }
    if modifiers.contains(.option) {
      value += "⌥"
    }
    if modifiers.contains(.control) {
      value += "⌃"
    }
    return value
  }

  private static func key(_ key: KeyEquivalent) -> String {
    switch key {
    case .upArrow:
      return "↑"
    case .downArrow:
      return "↓"
    case .leftArrow:
      return "←"
    case .rightArrow:
      return "→"
    case .home:
      return "↖"
    case .end:
      return "↘"
    case .delete:
      return "⌫"
    case .pageUp:
      return "⇞"
    case .pageDown:
      return "⇟"
    case .escape:
      return "Esc"
    case .return:
      return "↩"
    case .tab:
      return "⇥"
    case .space:
      return "Space"
    default:
      return String(key.character).uppercased()
    }
  }

  private struct CuratedEntry {
    let action: String?
    let fallbackShortcut: String
    let title: String
  }

  private static let curatedEntries: [CuratedEntry] = [
    .init(action: nil, fallbackShortcut: "⌘S", title: "Toggle sidebar"),
    .init(action: "new_tab", fallbackShortcut: "⌘T", title: "New tab"),
    .init(action: "close_surface", fallbackShortcut: "⌘W", title: "Close pane"),
    .init(action: "close_tab", fallbackShortcut: "⌘⌥W", title: "Close tab"),
    .init(action: nil, fallbackShortcut: "⌃1-0", title: "Go to space 1-10"),
    .init(action: "new_split:right", fallbackShortcut: "⌘D", title: "Split right"),
    .init(action: "new_split:down", fallbackShortcut: "⌘⇧D", title: "Split down"),
    .init(action: "start_search", fallbackShortcut: "⌘F", title: "Find"),
  ]
}
