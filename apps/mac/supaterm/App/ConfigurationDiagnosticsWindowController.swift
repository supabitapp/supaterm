import AppKit
import SwiftUI

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
    let window = NSWindow(
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
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func update(messages: [String]) {
    hostingController.rootView = ConfigurationDiagnosticsView(
      messages: messages,
      onIgnore: { [weak self] in
        self?.update(messages: [])
      },
      onReload: { [notificationCenter] in
        notificationCenter.post(name: .ghosttyRuntimeReloadRequested, object: nil)
      }
    )
    guard !messages.isEmpty else {
      close()
      return
    }
    guard window?.isVisible != true else { return }
    showWindow(nil)
  }
}
