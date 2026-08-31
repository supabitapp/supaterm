import AppKit
import Testing

@testable import supaterm

struct CommandHoldObserverTests {
  @Test
  func commandPressShowsShortcutsImmediately() {
    let observer = CommandHoldObserver()

    observer.update(modifierFlags: [.command])

    #expect(observer.isPressed)
  }

  @Test
  func commandReleaseHidesShortcutsImmediately() {
    let observer = CommandHoldObserver()
    observer.update(modifierFlags: [.command])

    observer.update(modifierFlags: [])

    #expect(observer.isPressed == false)
  }

  @Test
  func shouldShowShortcutsForCommandModifier() {
    #expect(CommandHoldObserver.shouldShowShortcuts(for: [.command]))
    #expect(CommandHoldObserver.shouldShowShortcuts(for: [.command, .shift]))
  }

  @Test
  func shouldNotShowShortcutsWithoutCommandModifier() {
    #expect(CommandHoldObserver.shouldShowShortcuts(for: []) == false)
    #expect(CommandHoldObserver.shouldShowShortcuts(for: [.control]) == false)
    #expect(CommandHoldObserver.shouldShowShortcuts(for: [.option, .shift]) == false)
  }

  @Test
  func optionModifierIsDetectedIndependently() {
    #expect(CommandHoldObserver.optionIsPressed(for: [.option]))
    #expect(CommandHoldObserver.optionIsPressed(for: [.command, .option]))
    #expect(CommandHoldObserver.optionIsPressed(for: [.command]) == false)
  }
}
