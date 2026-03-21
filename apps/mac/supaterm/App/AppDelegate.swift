import AppKit
import ComposableArchitecture

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let menuController: SupatermMenuController
  private let socketStore: StoreOf<SocketControlFeature>
  private let terminalWindowRegistry: TerminalWindowRegistry
  private var windowControllers: [UUID: TerminalWindowController] = [:]

  override init() {
    GhosttyBootstrap.initialize()
    let terminalWindowRegistry = TerminalWindowRegistry()
    let menuController = SupatermMenuController(registry: terminalWindowRegistry)
    let socketStore = Store(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.terminalWindowsClient = .live(registry: terminalWindowRegistry)
    }
    self.menuController = menuController
    self.socketStore = socketStore
    self.terminalWindowRegistry = terminalWindowRegistry
    super.init()
    terminalWindowRegistry.onChange = { [weak menuController] in
      menuController?.refresh()
    }
    menuController.setNewWindowAction { [weak self] in
      self?.performNewWindow() ?? false
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
    menuController.install()
    socketStore.send(.task)
    _ = performNewWindow()
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    guard !NSApp.windows.contains(where: \.isVisible) else { return }
    _ = showExistingWindowOrCreate()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if flag { return true }
    return showExistingWindowOrCreate() ? false : true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let targetWindow = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else {
      return .terminateNow
    }
    return terminalWindowRegistry.requestQuit(for: targetWindow) ? .terminateLater : .terminateNow
  }

  @discardableResult
  func performNewWindow() -> Bool {
    let controller = TerminalWindowController(registry: terminalWindowRegistry)
    controller.onWindowWillClose = { [weak self] controller in
      self?.windowControllers.removeValue(forKey: controller.appWindowController.sceneID)
    }
    windowControllers[controller.appWindowController.sceneID] = controller
    controller.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    controller.window?.makeKeyAndOrderFront(nil)
    return true
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    terminalWindowRegistry.requestCloseAllWindows()
  }

  private func showExistingWindowOrCreate() -> Bool {
    if let window = windowControllers.values.compactMap(\.window).first {
      if window.isMiniaturized {
        window.deminiaturize(nil)
      }
      NSApp.activate(ignoringOtherApps: true)
      window.makeKeyAndOrderFront(nil)
      return true
    }
    return performNewWindow()
  }
}
