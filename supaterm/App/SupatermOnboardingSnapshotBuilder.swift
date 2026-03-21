import SupatermCLIShared
import SwiftUI

@MainActor
enum SupatermOnboardingSnapshotBuilder {
  static func snapshot(
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingSnapshot {
    var items: [SupatermOnboardingShortcut] = [
      .init(shortcut: "⌘S", title: "Toggle sidebar")
    ]

    appendGhosttyShortcut(
      action: "new_tab",
      title: "New tab",
      to: &items,
      shortcutForAction: shortcutForAction
    )
    appendGhosttyShortcut(
      action: "close_surface",
      title: "Close pane",
      to: &items,
      shortcutForAction: shortcutForAction
    )
    appendGhosttyShortcut(
      action: "close_tab",
      title: "Close tab",
      to: &items,
      shortcutForAction: shortcutForAction
    )

    items.append(.init(shortcut: "⌃1-0", title: "Go to space 1-10"))

    appendGhosttyShortcut(
      action: "new_split:right",
      title: "Split right",
      to: &items,
      shortcutForAction: shortcutForAction
    )
    appendGhosttyShortcut(
      action: "new_split:down",
      title: "Split down",
      to: &items,
      shortcutForAction: shortcutForAction
    )
    appendGhosttyShortcut(
      action: "start_search",
      title: "Find",
      to: &items,
      shortcutForAction: shortcutForAction
    )

    return .init(items: items)
  }

  private static func appendGhosttyShortcut(
    action: String,
    title: String,
    to items: inout [SupatermOnboardingShortcut],
    shortcutForAction: (String) -> KeyboardShortcut?
  ) {
    guard let shortcut = format(shortcutForAction(action)) else { return }
    items.append(.init(shortcut: shortcut, title: title))
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
}
