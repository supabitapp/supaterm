import SwiftUI
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SupatermOnboardingSnapshotBuilderTests {
  @Test
  func snapshotIncludesOrderedCoreShortcuts() {
    let shortcuts: [String: KeyboardShortcut] = [
      "close_surface": KeyboardShortcut("w", modifiers: .command),
      "close_tab": KeyboardShortcut("w", modifiers: [.command, .shift]),
      "new_split:down": KeyboardShortcut("d", modifiers: [.command, .shift]),
      "new_split:right": KeyboardShortcut("d", modifiers: .command),
      "new_tab": KeyboardShortcut("t", modifiers: .command),
      "start_search": KeyboardShortcut("f", modifiers: .command),
    ]

    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { action in
      shortcuts[action]
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
  func snapshotOmitsUnboundGhosttyShortcuts() {
    let snapshot = SupatermOnboardingSnapshotBuilder.snapshot { action in
      guard action == "new_tab" else { return nil }
      return KeyboardShortcut("t", modifiers: .command)
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
