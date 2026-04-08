import SupatermCLIShared
import SwiftUI

@MainActor
enum SupatermOnboardingSnapshotBuilder {
  static func snapshot(
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingSnapshot {
    .init(items: onboardingItems(shortcutForAction: shortcutForAction))
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
    if let action = entry.action, let shortcut = shortcutForAction(action)?.display {
      return shortcut
    }
    return entry.fallbackShortcut
  }

  private struct CuratedEntry {
    let action: String?
    let fallbackShortcut: String
    let title: String
  }

  private static let curatedEntries: [CuratedEntry] = [
    .init(action: "toggle_command_palette", fallbackShortcut: "⌘⇧P", title: "Open command palette"),
    .init(action: nil, fallbackShortcut: "⌘S", title: "Toggle sidebar"),
    .init(action: SupatermCommand.newTab.ghosttyBindingAction, fallbackShortcut: "⌘T", title: "New tab"),
    .init(action: SupatermCommand.closeSurface.ghosttyBindingAction, fallbackShortcut: "⌘W", title: "Close pane"),
    .init(action: SupatermCommand.closeTab.ghosttyBindingAction, fallbackShortcut: "⌘⌥W", title: "Close tab"),
    .init(action: nil, fallbackShortcut: "⌃1-0", title: "Go to space 1-10"),
    .init(action: SupatermCommand.newSplit(.right).ghosttyBindingAction, fallbackShortcut: "⌘D", title: "Split right"),
    .init(action: SupatermCommand.newSplit(.down).ghosttyBindingAction, fallbackShortcut: "⌘⇧D", title: "Split down"),
    .init(action: SupatermCommand.startSearch.ghosttyBindingAction, fallbackShortcut: "⌘F", title: "Find"),
  ]
}
