import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  var onQuitRequested: (NSWindow) -> Bool = { _ in false }
  var menuController: SupatermMenuController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
    menuController?.install()
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let targetWindow = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else {
      return .terminateNow
    }
    return onQuitRequested(targetWindow) ? .terminateLater : .terminateNow
  }

  @discardableResult
  func performNewWindow() -> Bool {
    menuController?.performNewWindow() ?? false
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    menuController?.performCloseAllWindows() ?? false
  }
}
