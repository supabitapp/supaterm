import Carbon.HIToolbox
import SupatermSupport
import SwiftUI
import Testing

@MainActor
struct SupatermShortcutsTests {
  @Test
  func defaultsCoverEveryAppShortcut() {
    #expect(SupatermShortcuts.all.count == 19)
    #expect(Set(SupatermShortcuts.all.map(\.id)).count == SupatermShortcuts.all.count)
    #expect(SupatermShortcuts.jumpToLatestUnread.defaultBinding.display == "⌘⌃U")
    #expect(SupatermShortcuts.newTabInProject.defaultBinding.display == "⌘⌥T")
    #expect(SupatermShortcuts.nextSpace.defaultBinding.display == "⌘⌃→")
    #expect(SupatermShortcuts.openPullRequest.defaultBinding.display == "⌘⌥P")
    #expect(SupatermShortcuts.previousSpace.defaultBinding.display == "⌘⌃←")
    #expect(SupatermShortcuts.selectSpaces.last?.defaultBinding.display == "⌃0")
  }

  @Test
  func overrideReplacesDefaultBinding() {
    let override = SupatermShortcutOverride(
      keyCode: UInt16(kVK_ANSI_B),
      modifiers: [.command, .shift]
    )

    let binding = SupatermShortcuts.toggleSidebar.effective(
      from: [.toggleSidebar: override]
    )

    #expect(binding?.display == "⌘⇧B")
    #expect(binding?.keyboardShortcut.key == "b")
  }

  @Test
  func disabledOverrideRemovesBinding() {
    #expect(
      SupatermShortcuts.toggleSidebar.effective(
        from: [.toggleSidebar: .disabled]
      ) == nil
    )
  }

  @Test
  func conflictFindsAnotherAppShortcut() {
    let conflict = SupatermShortcuts.conflict(
      for: SupatermShortcuts.toggleAgentPanel.defaultBinding,
      replacing: .toggleSidebar,
      overrides: [:],
      terminalDisplays: []
    )

    #expect(conflict == "Toggle Agent Panel")
  }

  @Test
  func conflictFindsTerminalShortcut() {
    let binding = SupatermShortcuts.toggleSidebar.defaultBinding
    let conflict = SupatermShortcuts.conflict(
      for: binding,
      replacing: .toggleSidebar,
      overrides: [:],
      terminalDisplays: [binding.display]
    )

    #expect(conflict == "Terminal")
  }
}
