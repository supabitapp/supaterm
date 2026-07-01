import AppKit
import SwiftUI

@MainActor
final class SnapshotCatalogAppDelegate: NSObject, NSApplicationDelegate {
  private lazy var window: NSWindow = {
    let hostingController = NSHostingController(rootView: SnapshotCatalogRootView())
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Snapshot Catalog"
    window.contentViewController = hostingController
    return window
  }()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false

    window.center()
    window.makeKeyAndOrderFront(nil)

    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}
