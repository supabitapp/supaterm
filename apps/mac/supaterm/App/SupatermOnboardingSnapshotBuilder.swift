import SupatermCLIShared
import SwiftUI

@MainActor
enum SupatermOnboardingSnapshotBuilder {
  static func snapshot(
    hasShortcutSource: Bool = false,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingSnapshot {
    .init(
      items: onboardingItems(
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ))
  }

  private static func onboardingItems(
    hasShortcutSource: Bool,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> [SupatermOnboardingShortcut] {
    [
      resolvedItem(
        for: .init(
          action: "toggle_command_palette",
          fallbackShortcut: "⌘⇧P",
          title: "Open command palette"
        ),
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
      resolvedItem(
        for: .init(action: nil, fallbackShortcut: "⌘S", title: "Toggle sidebar"),
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
      resolvedItem(
        for: .init(
          action: SupatermCommand.newTab.ghosttyBindingAction,
          fallbackShortcut: "⌘T",
          title: "New tab"
        ),
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
    ]
    .compactMap { $0 }
      + tabNavigationItems(
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      )
      + [
        resolvedItem(
          for: .init(
            action: SupatermCommand.closeSurface.ghosttyBindingAction,
            fallbackShortcut: "⌘W",
            title: "Close pane"
          ),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
        resolvedItem(
          for: .init(
            action: SupatermCommand.closeTab.ghosttyBindingAction,
            fallbackShortcut: "⌘⌥W",
            title: "Close tab"
          ),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
        resolvedItem(
          for: .init(action: nil, fallbackShortcut: "⌃1-0", title: "Go to space 1-10"),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
        resolvedItem(
          for: .init(
            action: SupatermCommand.newSplit(.right).ghosttyBindingAction,
            fallbackShortcut: "⌘D",
            title: "Split right"
          ),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
        resolvedItem(
          for: .init(
            action: SupatermCommand.newSplit(.down).ghosttyBindingAction,
            fallbackShortcut: "⌘⇧D",
            title: "Split down"
          ),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
        resolvedItem(
          for: .init(
            action: SupatermCommand.startSearch.ghosttyBindingAction,
            fallbackShortcut: "⌘F",
            title: "Find"
          ),
          hasShortcutSource: hasShortcutSource,
          shortcutForAction: shortcutForAction
        ),
      ]
      .compactMap { $0 }
  }

  private static func resolvedItem(
    for entry: CuratedEntry,
    hasShortcutSource: Bool,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingShortcut? {
    if let action = entry.action {
      if let shortcut = shortcutForAction(action)?.display {
        return .init(shortcut: shortcut, title: entry.title)
      }
      if hasShortcutSource {
        return nil
      }
    }
    return .init(shortcut: entry.fallbackShortcut, title: entry.title)
  }

  private static func tabNavigationItems(
    hasShortcutSource: Bool,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> [SupatermOnboardingShortcut] {
    [
      tabRangeItem(
        title: "Go to tabs 1-8",
        start: 1,
        end: 8,
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
      tabItem(
        title: "Last tab",
        command: .lastTab,
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
      tabItem(
        title: "Go to tab 10",
        command: .goToTab(10),
        hasShortcutSource: hasShortcutSource,
        shortcutForAction: shortcutForAction
      ),
    ]
    .compactMap { $0 }
  }

  private static func tabRangeItem(
    title: String,
    start: Int,
    end: Int,
    hasShortcutSource: Bool,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingShortcut? {
    let shortcut =
      hasShortcutSource
      ? tabRangeShortcut(start: start, end: end) { command in
        shortcutForAction(command.ghosttyBindingAction)?.display
      }
      : tabRangeShortcut(start: start, end: end) { command in
        command.defaultKeyboardShortcut?.display
      }
    guard let shortcut else { return nil }
    return .init(shortcut: shortcut, title: title)
  }

  private static func tabItem(
    title: String,
    command: SupatermCommand,
    hasShortcutSource: Bool,
    shortcutForAction: (String) -> KeyboardShortcut?
  ) -> SupatermOnboardingShortcut? {
    if let shortcut = shortcutForAction(command.ghosttyBindingAction)?.display {
      return .init(shortcut: shortcut, title: title)
    }
    guard !hasShortcutSource, let shortcut = command.defaultKeyboardShortcut?.display else {
      return nil
    }
    return .init(shortcut: shortcut, title: title)
  }

  private static func tabRangeShortcut(
    start: Int,
    end: Int,
    shortcutDisplay: (SupatermCommand) -> String?
  ) -> String? {
    let startCommand = SupatermCommand.goToTab(start)
    let endCommand = SupatermCommand.goToTab(end)
    let startShortcut = shortcutDisplay(startCommand)
    let endShortcut = shortcutDisplay(endCommand)
    guard let startShortcut, let endShortcut else { return nil }
    guard startShortcut.last == Character(String(start)) else { return nil }
    guard endShortcut.last == Character(String(end)) else { return nil }
    let startPrefix = String(startShortcut.dropLast())
    let endPrefix = String(endShortcut.dropLast())
    guard startPrefix == endPrefix else { return nil }
    return "\(startPrefix)\(start)-\(end)"
  }

  private struct CuratedEntry {
    let action: String?
    let fallbackShortcut: String
    let title: String
  }
}
