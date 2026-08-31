import AppKit
import Observation

@MainActor
@Observable
final class CommandHoldObserver {
  var isPressed = false
  var isOptionPressed = false

  nonisolated static func shouldShowShortcuts(for modifierFlags: NSEvent.ModifierFlags) -> Bool {
    modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command)
  }

  nonisolated static func optionIsPressed(for modifierFlags: NSEvent.ModifierFlags) -> Bool {
    modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.option)
  }

  func update(modifierFlags: NSEvent.ModifierFlags) {
    isOptionPressed = Self.optionIsPressed(for: modifierFlags)
    isPressed = Self.shouldShowShortcuts(for: modifierFlags)
  }

  func reset() {
    isOptionPressed = false
    isPressed = false
  }
}
