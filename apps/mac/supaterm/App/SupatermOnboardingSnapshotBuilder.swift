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
    if let command = entry.command, let shortcut = shortcutForCommand(command)?.display {
      return shortcut
    }
    return entry.fallbackShortcut
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
