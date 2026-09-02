import AppKit
import SupatermSupport
import SwiftUI

@MainActor
private final class ConfigurationDiagnosticsWindow: NSWindow {
  var onCancelAction: () -> Void = {}
  var onDefaultAction: () -> Void = {}

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown,
      event.modifierFlags.isDisjoint(with: [.command, .control, .option, .shift])
    else {
      return super.performKeyEquivalent(with: event)
    }

    switch event.charactersIgnoringModifiers {
    case "\u{1b}":
      onCancelAction()
    case "\r":
      onDefaultAction()
    default:
      return super.performKeyEquivalent(with: event)
    }
    return true
  }
}

@MainActor
final class ConfigurationDiagnosticsWindowController: NSWindowController {
  private let hostingController: NSHostingController<ConfigurationDiagnosticsView>
  private let notificationCenter: NotificationCenter

  init(notificationCenter: NotificationCenter = .default) {
    let hostingController = NSHostingController(
      rootView: ConfigurationDiagnosticsView(
        messages: [],
        onIgnore: {},
        onReload: {}
      )
    )
    self.hostingController = hostingController
    self.notificationCenter = notificationCenter
    let window = ConfigurationDiagnosticsWindow(
      contentRect: NSRect(x: 0, y: 0, width: 480, height: 270),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Configuration Errors"
    window.level = .popUpMenu
    window.tabbingMode = .disallowed
    window.isReleasedWhenClosed = false
    window.isRestorable = false
    window.center()
    window.contentViewController = hostingController
    super.init(window: window)
    window.onCancelAction = { [weak self] in self?.ignore() }
    window.onDefaultAction = { [weak self] in self?.reload() }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func update(messages: [String]) {
    hostingController.rootView = ConfigurationDiagnosticsView(
      messages: messages,
      onIgnore: { [weak self] in
        self?.ignore()
      },
      onReload: { [weak self] in
        self?.reload()
      }
    )
    guard !messages.isEmpty else {
      close()
      return
    }
    guard let window, !window.isVisible else { return }
    window.makeKeyAndOrderFront(nil)
    Task { @MainActor [weak window] in
      guard let window, window.isVisible else { return }
      window.makeKey()
    }
  }

  private func ignore() {
    update(messages: [])
  }

  private func reload() {
    notificationCenter.post(name: .ghosttyRuntimeReloadRequested, object: nil)
  }
}
