import AppKit
import Carbon.HIToolbox
import SupatermSupport
import SwiftUI
import Testing

@MainActor
struct SupatermShortcutsTests {
  @Test
  func defaultsCoverEveryAppShortcut() throws {
    let u = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_U),
        modifiers: .command
      )
    )
    let t = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_T),
        modifiers: .command
      )
    )
    let p = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_P),
        modifiers: .command
      )
    )
    let zero = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_0),
        modifiers: []
      )
    )

    #expect(SupatermShortcuts.all.count == 19)
    #expect(Set(SupatermShortcuts.all.map(\.id)).count == SupatermShortcuts.all.count)
    #expect(SupatermShortcuts.jumpToLatestUnread.defaultBinding.display == "⌘\(String(u).uppercased())")
    #expect(SupatermShortcuts.newTabInGroup.defaultBinding.display == "⌘⌥\(String(t).uppercased())")
    #expect(SupatermShortcuts.nextSpace.defaultBinding.display == "⌘⌃→")
    #expect(SupatermShortcuts.openPullRequest.defaultBinding.display == "⌘⌥\(String(p).uppercased())")
    #expect(SupatermShortcuts.previousSpace.defaultBinding.display == "⌘⌃←")
    #expect(SupatermShortcuts.selectSpaces.last?.defaultBinding.display == "⌃\(String(zero).uppercased())")
  }

  @Test
  func overrideReplacesDefaultBinding() throws {
    let override = SupatermShortcutOverride(
      keyCode: UInt16(kVK_ANSI_B),
      modifiers: [.command, .shift]
    )

    let binding = SupatermShortcuts.toggleSidebar.effective(
      from: [.toggleSidebar: override]
    )

    let expected = try #require(
      SupatermKeyboardLayout.character(
        for: UInt16(kVK_ANSI_B),
        modifiers: .command
      )
    )
    #expect(binding?.display == "⌘⇧\(String(expected).uppercased())")
    #expect(binding?.keyboardShortcut.key == KeyEquivalent(expected))
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

  @Test
  func keyboardLayoutUsesOnlyCommandModifier() throws {
    let keyCode = UInt16(kVK_ANSI_A)
    let unmodified = try #require(
      SupatermKeyboardLayout.character(for: keyCode, modifiers: [])
    )
    let nonCommand = try #require(
      SupatermKeyboardLayout.character(
        for: keyCode,
        modifiers: [.shift, .control, .option]
      )
    )
    let command = try #require(
      SupatermKeyboardLayout.character(for: keyCode, modifiers: .command)
    )
    let commandWithOtherModifiers = try #require(
      SupatermKeyboardLayout.character(
        for: keyCode,
        modifiers: [.command, .shift, .control, .option]
      )
    )

    #expect(nonCommand == unmodified)
    #expect(commandWithOtherModifiers == command)
  }

  @Test
  func keyboardLayoutRejectsInvalidKeyCode() {
    #expect(
      SupatermKeyboardLayout.character(
        for: UInt16.max,
        modifiers: []
      ) == nil
    )
  }
}
