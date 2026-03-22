import AppKit
import ComposableArchitecture

@MainActor
protocol GhosttyAppActionPerforming: AnyObject {
  func performCheckForUpdates() -> Bool
  func performCloseAllWindows() -> Bool
  func performNewWindow() -> Bool
  func performQuit() -> Bool
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, GhosttyAppActionPerforming {
  private let menuController: SupatermMenuController
  private let socketStore: StoreOf<SocketControlFeature>
  private let terminalWindowRegistry: TerminalWindowRegistry
  private var settingsWindowController: SettingsWindowController?
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
    menuController.setShowSettingsAction { [weak self] tab in
      self?.performShowSettings(tab: tab) ?? false
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
    Self.terminateReply(
      hasVisibleTerminalWindows: terminalWindowRegistry.hasVisibleTerminalWindows,
      bypassesQuitConfirmation: terminalWindowRegistry.bypassesQuitConfirmation,
      needsQuitConfirmation: terminalWindowRegistry.needsQuitConfirmation
    ) {
      let alert = NSAlert()
      alert.messageText = "Quit Supaterm?"
      alert.informativeText = "All terminal sessions will be terminated."
      alert.addButton(withTitle: "Quit Supaterm")
      alert.addButton(withTitle: "Cancel")
      alert.alertStyle = .warning
      return alert.runModal() == .alertFirstButtonReturn
    }
  }

  @discardableResult
  func performNewWindow() -> Bool {
    let controller = TerminalWindowController(registry: terminalWindowRegistry)
    controller.onWindowWillClose = { [weak self] controller in
      self?.windowControllers.removeValue(forKey: controller.windowControllerID)
    }
    windowControllers[controller.windowControllerID] = controller
    controller.showWindow(nil)
    NSApp.activate(ignoringOtherApps: true)
    controller.window?.makeKeyAndOrderFront(nil)
    return true
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    terminalWindowRegistry.requestCloseAllWindows()
  }

  @discardableResult
  func performCheckForUpdates() -> Bool {
    menuController.performCheckForUpdates()
  }

  @discardableResult
  func performQuit() -> Bool {
    NSApp.terminate(nil)
    return true
  }

  @discardableResult
  func performShowSettings(tab: SettingsFeature.Tab) -> Bool {
    let controller: SettingsWindowController
    if let settingsWindowController {
      controller = settingsWindowController
    } else {
      let createdController = SettingsWindowController()
      settingsWindowController = createdController
      controller = createdController
    }
    controller.show(tab: tab)
    return true
  }

  @discardableResult
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
    menuController.performGhosttyBindingMenuKeyEquivalent(with: event)
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

  static func terminateReply(
    hasVisibleTerminalWindows: Bool,
    bypassesQuitConfirmation: Bool,
    needsQuitConfirmation: Bool,
    confirmQuit: () -> Bool
  ) -> NSApplication.TerminateReply {
    guard hasVisibleTerminalWindows else { return .terminateNow }
    guard !bypassesQuitConfirmation else { return .terminateNow }
    guard needsQuitConfirmation else { return .terminateNow }
    return confirmQuit() ? .terminateNow : .terminateCancel
  }
}
