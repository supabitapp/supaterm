import Observation
import SwiftUI

@MainActor
@Observable
final class GhosttyShortcutManager {
  private let runtime: GhosttyRuntime
  private var generation = 0

  init(runtime: GhosttyRuntime) {
    self.runtime = runtime
    runtime.onConfigChange = { [weak self] in
      self?.refresh()
    }
  }

  func refresh() {
    generation += 1
  }

  func keyboardShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    _ = generation
    return runtime.keyboardShortcut(for: command)
  }
}
