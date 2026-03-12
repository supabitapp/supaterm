import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let targetWindow = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else {
      return .terminateNow
    }

    NotificationCenter.default.post(name: .quitRequested, object: targetWindow)
    return .terminateLater
  }
}
