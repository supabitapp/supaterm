import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private let updateRelaunchCoordinator: UpdateRelaunchCoordinator

  override init() {
    updateRelaunchCoordinator = .shared
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if updateRelaunchCoordinator.bypassesQuitConfirmation {
      return .terminateNow
    }

    guard let targetWindow = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else {
      return .terminateNow
    }

    NotificationCenter.default.post(name: .quitRequested, object: targetWindow)
    return .terminateLater
  }
}
