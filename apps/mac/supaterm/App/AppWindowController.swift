import AppKit
import Combine
import ComposableArchitecture
import SwiftUI

@MainActor
final class AppWindowController: NSObject, ObservableObject {
  let objectWillChange = ObservableObjectPublisher()
  let sceneID = UUID()
  let ghostty: GhosttyRuntime
  let ghosttyShortcuts: GhosttyShortcutManager
  let terminal: TerminalHostState
  let store: StoreOf<AppFeature>

  private let registry: TerminalWindowRegistry
  private weak var window: NSWindow?
  private var previousWindowDelegate: NSWindowDelegate?
  private var isPresentingCloseAlert = false

  init(registry: TerminalWindowRegistry) {
    self.registry = registry

    let ghostty = GhosttyRuntime()
    let terminal = TerminalHostState(runtime: ghostty)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
        ._printChanges(.actionLabels)
    } withDependencies: {
      $0.terminalClient = .live(host: terminal)
    }

    self.ghostty = ghostty
    self.ghosttyShortcuts = GhosttyShortcutManager(runtime: ghostty)
    self.terminal = terminal
    self.store = store

    super.init()

    registry.register(
      keyboardShortcut: { [ghosttyShortcuts] action in
        ghosttyShortcuts.keyboardShortcut(for: action)
      },
      sceneID: sceneID,
      store: store,
      terminal: terminal
    )
  }

  deinit {
    let sceneID = self.sceneID
    let registry = self.registry
    Task { @MainActor in
      registry.unregister(sceneID: sceneID)
    }
  }

  func updateWindow(_ window: NSWindow?) {
    guard self.window !== window else {
      registry.updateWindow(window, for: sceneID)
      return
    }

    if let currentWindow = self.window, currentWindow.delegate === self {
      currentWindow.delegate = previousWindowDelegate
    }

    self.window = window
    previousWindowDelegate = nil

    if let window {
      previousWindowDelegate = window.delegate
      window.delegate = self
    }

    registry.updateWindow(window, for: sceneID)
  }
}

extension AppWindowController: NSWindowDelegate {
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if previousWindowDelegate?.windowShouldClose?(sender) == false {
      return false
    }
    guard terminal.windowNeedsCloseConfirmation() else { return true }
    guard !isPresentingCloseAlert else { return false }

    isPresentingCloseAlert = true

    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "Close Window?"
    alert.informativeText = "A process is still running in this window. Close it anyway?"
    alert.addButton(withTitle: "Close")
    alert.addButton(withTitle: "Cancel")
    alert.beginSheetModal(for: sender) { [weak self] response in
      guard let self else { return }
      self.isPresentingCloseAlert = false
      if response == .alertFirstButtonReturn {
        sender.close()
      }
    }

    return false
  }

  func windowWillClose(_ notification: Notification) {
    if let closingWindow = notification.object as? NSWindow, closingWindow === window {
      registry.updateWindow(nil, for: sceneID)
      window = nil
    }
    previousWindowDelegate?.windowWillClose?(notification)
  }
}
