import AppKit
import SwiftUI

@MainActor
final class TerminalWindowController: NSWindowController {
  let appWindowController: AppWindowController
  var onWindowWillClose: ((TerminalWindowController) -> Void)?

  init(registry: TerminalWindowRegistry) {
    let appWindowController = AppWindowController(registry: registry)
    self.appWindowController = appWindowController

    let hostingController = NSHostingController(
      rootView: GhosttyColorSchemeSyncView(ghostty: appWindowController.ghostty) {
        ContentView(
          store: appWindowController.store,
          terminal: appWindowController.terminal,
          onWindowChanged: appWindowController.updateWindow
        )
      }
    )

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = hostingController
    window.contentMinSize = NSSize(width: 1_080, height: 720)
    window.identifier = NSUserInterfaceItemIdentifier(
      "app.supabit.supaterm.window.\(appWindowController.sceneID.uuidString)")
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Supaterm"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true

    super.init(window: window)

    appWindowController.updateWindow(window)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(windowWillClose(_:)),
      name: NSWindow.willCloseNotification,
      object: window
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  @objc private func windowWillClose(_ notification: Notification) {
    onWindowWillClose?(self)
  }
}
