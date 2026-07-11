import Observation
import SwiftUI

@MainActor
@Observable
final class GhosttyShortcutManager {
  private let runtime: GhosttyRuntime?
  @ObservationIgnored private var configObserver: NSObjectProtocol?
  private var generation = 0

  init(runtime: GhosttyRuntime?) {
    self.runtime = runtime
    guard let runtime else { return }
    configObserver = NotificationCenter.default.addObserver(
      forName: .ghosttyRuntimeConfigDidChange,
      object: runtime,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.refresh()
      }
    }
  }

  isolated deinit {
    if let configObserver {
      NotificationCenter.default.removeObserver(configObserver)
    }
  }

  private func refresh() {
    generation += 1
  }

  func keyboardShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    keyboardShortcut(forAction: command.ghosttyBindingAction)
  }

  func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    _ = generation
    return runtime?.keyboardShortcut(forAction: action)
  }
}
