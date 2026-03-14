import Testing

@testable import supaterm

struct AppShortcutsTests {
  @Test
  func ghosttyUnbindArgumentsCoverHostOwnedTabShortcuts() {
    let arguments = AppShortcuts.ghosttyCLIKeybindArguments

    #expect(arguments.contains("--keybind=super+t=unbind"))
    #expect(arguments.contains("--keybind=super+w=unbind"))
    #expect(arguments.contains("--keybind=shift+super+]=unbind"))
    #expect(arguments.contains("--keybind=shift+super+[=unbind"))
  }

  @Test
  func ghosttyUnbindArgumentsCoverTabSlotBindings() {
    let arguments = AppShortcuts.ghosttyCLIKeybindArguments

    #expect(arguments.contains("--keybind=super+1=unbind"))
    #expect(arguments.contains("--keybind=super+0=unbind"))
    #expect(arguments.contains("--keybind=super+digit_1=unbind"))
    #expect(arguments.contains("--keybind=super+digit_0=unbind"))
  }
}
