import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  var onQuitRequested: (NSWindow) -> Bool = { _ in false }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let targetWindow = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else {
      return .terminateNow
    }
    return onQuitRequested(targetWindow) ? .terminateLater : .terminateNow
  }
}
