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
        SupatermOnboardingShortcut(shortcut: "⌘⇧P", title: "Open command palette"),
        SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
        SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
        SupatermOnboardingShortcut(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
        SupatermOnboardingShortcut(shortcut: "⌘9", title: "Last tab"),
        SupatermOnboardingShortcut(shortcut: "⌘W", title: "Close pane"),
        SupatermOnboardingShortcut(shortcut: "⌘⇧W", title: "Close tab"),
        SupatermOnboardingShortcut(shortcut: "⌃1-0", title: "Go to space 1-10"),
        SupatermOnboardingShortcut(shortcut: "⌘D", title: "Split right"),
        SupatermOnboardingShortcut(shortcut: "⌘⇧D", title: "Split down"),
        SupatermOnboardingShortcut(shortcut: "⌘F", title: "Find"),
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
        SupatermOnboardingShortcut(shortcut: "⌘⇧P", title: "Open command palette"),
        SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
        SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
        SupatermOnboardingShortcut(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
        SupatermOnboardingShortcut(shortcut: "⌘0", title: "Go to tab 10"),
        SupatermOnboardingShortcut(shortcut: "⌘W", title: "Close pane"),
        SupatermOnboardingShortcut(shortcut: "⌘⌥W", title: "Close tab"),
        SupatermOnboardingShortcut(shortcut: "⌃1-0", title: "Go to space 1-10"),
        SupatermOnboardingShortcut(shortcut: "⌘D", title: "Split right"),
        SupatermOnboardingShortcut(shortcut: "⌘⇧D", title: "Split down"),
        SupatermOnboardingShortcut(shortcut: "⌘F", title: "Find"),
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
        SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
        SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
        SupatermOnboardingShortcut(shortcut: "⌃1-0", title: "Go to space 1-10"),
      ]
    )
  }
}
