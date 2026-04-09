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
      SupatermCommand.lastTab.ghosttyBindingAction: KeyboardShortcut("9", modifiers: .command),
      SupatermCommand.closeSurface.ghosttyBindingAction: KeyboardShortcut("w", modifiers: .command),
      SupatermCommand.closeTab.ghosttyBindingAction: KeyboardShortcut("w", modifiers: [.command, .shift]),
      SupatermCommand.newSplit(.down).ghosttyBindingAction: KeyboardShortcut("d", modifiers: [.command, .shift]),
      SupatermCommand.newSplit(.right).ghosttyBindingAction: KeyboardShortcut("d", modifiers: .command),
      SupatermCommand.goToTab(1).ghosttyBindingAction: KeyboardShortcut("1", modifiers: .command),
      SupatermCommand.goToTab(8).ghosttyBindingAction: KeyboardShortcut("8", modifiers: .command),
      SupatermCommand.newTab.ghosttyBindingAction: KeyboardShortcut("t", modifiers: .command),
      SupatermCommand.startSearch.ghosttyBindingAction: KeyboardShortcut("f", modifiers: .command),
    ]

    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot(hasShortcutSource: true) { action in
      shortcuts[action]
    }

    #expect(
      snapshot.items == [
        .init(shortcut: "⌘⇧P", title: "Open command palette"),
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
        .init(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
        .init(shortcut: "⌘9", title: "Last tab"),
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
        .init(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
        .init(shortcut: "⌘0", title: "Go to tab 10"),
        .init(shortcut: "⌘W", title: "Close pane"),
        .init(shortcut: "⌘⌥W", title: "Close tab"),
        .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
        .init(shortcut: "⌘D", title: "Split right"),
        .init(shortcut: "⌘⇧D", title: "Split down"),
        .init(shortcut: "⌘F", title: "Find"),
      ]
    )
  }

  @Test
  func snapshotDoesNotInventMissingLiveBindings() {
    let shortcuts: [String: KeyboardShortcut] = [
      SupatermCommand.newTab.ghosttyBindingAction: KeyboardShortcut("t", modifiers: .command)
    ]

    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot(hasShortcutSource: true) { action in
      shortcuts[action]
    }

    #expect(
      snapshot.items == [
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
        .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
      ]
    )
  }
}
