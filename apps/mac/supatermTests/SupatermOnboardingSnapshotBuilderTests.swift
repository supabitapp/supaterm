import SwiftUI
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SupatermOnboardingSnapshotBuilderTests {
  @Test
  func snapshotIncludesOrderedCoreShortcuts() {
    let shortcuts: [SupatermCommand: KeyboardShortcut] = [
      .closeSurface: KeyboardShortcut("w", modifiers: .command),
      .closeTab: KeyboardShortcut("w", modifiers: [.command, .shift]),
      .newSplit(.down): KeyboardShortcut("d", modifiers: [.command, .shift]),
      .newSplit(.right): KeyboardShortcut("d", modifiers: .command),
      .newTab: KeyboardShortcut("t", modifiers: .command),
      .startSearch: KeyboardShortcut("f", modifiers: .command),
    ]

    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { command in
      shortcuts[command]
    }

    #expect(
      snapshot.items == [
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
    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { command in
      guard command == .newTab else { return nil }
      return KeyboardShortcut("t", modifiers: .command)
    }

    #expect(
      snapshot.items == [
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
