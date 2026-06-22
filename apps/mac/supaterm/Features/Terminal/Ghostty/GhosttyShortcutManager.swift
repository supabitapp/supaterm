import Observation
import SwiftUI

@MainActor
@Observable
public final class GhosttyShortcutManager {
  private let runtime: GhosttyRuntime
  private var generation = 0

  public init(runtime: GhosttyRuntime) {
    self.runtime = runtime
    runtime.onConfigChange = { [weak self] in
      self?.refresh()
    }
  }

  func refresh() {
    generation += 1
  }

  public func keyboardShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    keyboardShortcut(forAction: command.ghosttyBindingAction)
  }

  public func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    _ = generation
    return runtime.keyboardShortcut(forAction: action)
  }
}
