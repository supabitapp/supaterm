import AppKit
import Observation

@MainActor
@Observable
public final class CommandHoldObserver {
  private static let holdDelay: Duration = .milliseconds(300)

  public var isPressed = false
  public var isOptionPressed = false
  private var holdTask: Task<Void, Never>?

  public init() {}

  public nonisolated static func shouldShowShortcuts(for modifierFlags: NSEvent.ModifierFlags) -> Bool {
    modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command)
  }

  public nonisolated static func optionIsPressed(for modifierFlags: NSEvent.ModifierFlags) -> Bool {
    modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.option)
  }

  public func update(modifierFlags: NSEvent.ModifierFlags) {
    isOptionPressed = Self.optionIsPressed(for: modifierFlags)
    handleCommandKeyChange(isDown: Self.shouldShowShortcuts(for: modifierFlags))
  }

  public func reset() {
    isOptionPressed = false
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
