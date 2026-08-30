import AppKit
import Observation
import SwiftUI

@MainActor
@Observable
final class GhosttyShortcutManager {
  private let runtime: GhosttyRuntime?
  @ObservationIgnored private var configObserver: NSObjectProtocol?
  @ObservationIgnored private var keyboardLayoutObserver: NSObjectProtocol?
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
    keyboardLayoutObserver = NotificationCenter.default.addObserver(
      forName: NSTextInputContext.keyboardSelectionDidChangeNotification,
      object: nil,
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
    if let keyboardLayoutObserver {
      NotificationCenter.default.removeObserver(keyboardLayoutObserver)
    }
  }

  private func refresh() {
    generation += 1
  }

  func keyboardShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    keyboardShortcut(forAction: command.ghosttyBindingAction)
  }

  func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    shortcut(forAction: action)?.keyboardShortcut
  }

  func shortcut(forAction action: String) -> GhosttyShortcut? {
    _ = generation
    return runtime?.shortcut(forAction: action)
  }
}
