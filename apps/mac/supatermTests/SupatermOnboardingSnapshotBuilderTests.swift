import SwiftUI
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SupatermOnboardingSnapshotBuilderTests {
  @Test
  func snapshotIncludesOrderedCoreShortcuts() {
    let shortcuts: [String: KeyboardShortcut] = [
      "toggle_command_palette": KeyboardShortcut("p", modifiers: [.command, .shift]),
      SupatermCommand.closeSurface.ghosttyBindingAction: KeyboardShortcut("w", modifiers: .command),
      SupatermCommand.closeTab.ghosttyBindingAction: KeyboardShortcut("w", modifiers: [.command, .shift]),
      SupatermCommand.newSplit(.down).ghosttyBindingAction: KeyboardShortcut("d", modifiers: [.command, .shift]),
      SupatermCommand.newSplit(.right).ghosttyBindingAction: KeyboardShortcut("d", modifiers: .command),
      SupatermCommand.newTab.ghosttyBindingAction: KeyboardShortcut("t", modifiers: .command),
      SupatermCommand.startSearch.ghosttyBindingAction: KeyboardShortcut("f", modifiers: .command),
    ]

    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { action in
      shortcuts[action]
    }

    #expect(
      snapshot.items == [
        .init(shortcut: "⌘⇧P", title: "Open command palette"),
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
        .init(shortcut: "⌘W", title: "Close pane"),
        .init(shortcut: "⌘⇧W", title: "Close tab"),
        .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
        .init(shortcut: "⌘D", title: "Split right"),
        .init(shortcut: "⌘⇧D", title: "Split down"),
        .init(shortcut: "⌘F", title: "Find"),
      ]
    )
  }

  @Test
  func snapshotFallsBackToDefaultCoreShortcuts() {
    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { action in
      guard action == SupatermCommand.newTab.ghosttyBindingAction else { return nil }
      return KeyboardShortcut("t", modifiers: .command)
    }

    #expect(
      snapshot.items == [
        .init(shortcut: "⌘⇧P", title: "Open command palette"),
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
        .init(shortcut: "⌘W", title: "Close pane"),
        .init(shortcut: "⌘⌥W", title: "Close tab"),
        .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
        .init(shortcut: "⌘D", title: "Split right"),
        .init(shortcut: "⌘⇧D", title: "Split down"),
        .init(shortcut: "⌘F", title: "Find"),
      ]
    )
  }
}
