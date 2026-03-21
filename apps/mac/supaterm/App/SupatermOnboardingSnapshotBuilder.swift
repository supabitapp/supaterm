import SupatermCLIShared
import SwiftUI

@MainActor
enum SupatermOnboardingSnapshotBuilder {
  static func snapshot(
    shortcutForCommand: (SupatermCommand) -> KeyboardShortcut?
  ) -> SupatermOnboardingSnapshot {
    .init(items: onboardingItems(shortcutForCommand: shortcutForCommand))
  }

  private static func onboardingItems(
    shortcutForCommand: (SupatermCommand) -> KeyboardShortcut?
  ) -> [SupatermOnboardingShortcut] {
    curatedEntries.map { entry in
      .init(
        shortcut: resolvedShortcut(for: entry, shortcutForCommand: shortcutForCommand),
        title: entry.title
      )
    }
  }

  private static func resolvedShortcut(
    for entry: CuratedEntry,
    shortcutForCommand: (SupatermCommand) -> KeyboardShortcut?
  ) -> String {
    if let command = entry.command, let shortcut = format(shortcutForCommand(command)) {
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
    let command: SupatermCommand?
    let fallbackShortcut: String
    let title: String
  }

  private static let curatedEntries: [CuratedEntry] = [
    .init(command: nil, fallbackShortcut: "⌘S", title: "Toggle sidebar"),
    .init(command: .newTab, fallbackShortcut: "⌘T", title: "New tab"),
    .init(command: .closeSurface, fallbackShortcut: "⌘W", title: "Close pane"),
    .init(command: .closeTab, fallbackShortcut: "⌘⌥W", title: "Close tab"),
    .init(command: nil, fallbackShortcut: "⌃1-0", title: "Go to space 1-10"),
    .init(command: .newSplit(.right), fallbackShortcut: "⌘D", title: "Split right"),
    .init(command: .newSplit(.down), fallbackShortcut: "⌘⇧D", title: "Split down"),
    .init(command: .startSearch, fallbackShortcut: "⌘F", title: "Find"),
  ]
}
