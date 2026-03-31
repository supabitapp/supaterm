import AppKit
import Observation

@MainActor
@Observable
final class CommandHoldObserver {
  private static let holdDelay: Duration = .milliseconds(300)

  var isPressed = false
  private var holdTask: Task<Void, Never>?

  nonisolated static func shouldShowShortcuts(for modifierFlags: NSEvent.ModifierFlags) -> Bool {
    modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command)
  }

  func update(modifierFlags: NSEvent.ModifierFlags) {
    handleCommandKeyChange(isDown: Self.shouldShowShortcuts(for: modifierFlags))
  }

  func reset() {
    handleCommandKeyChange(isDown: false)
  }

  private func handleCommandKeyChange(isDown: Bool) {
    holdTask?.cancel()
    holdTask = nil

    if isDown {
      holdTask = Task {
        try? await ContinuousClock().sleep(for: Self.holdDelay)
        guard !Task.isCancelled else { return }
        isPressed = true
      }
    } else {
      isPressed = false
    }
  }
}
