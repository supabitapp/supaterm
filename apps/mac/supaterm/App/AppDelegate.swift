import AppKit
import ComposableArchitecture
import Sharing
import SupatermSettingsFeature
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore

@MainActor
protocol GhosttyAppActionPerforming: AnyObject {
  func performCheckForUpdates() -> Bool
  func performCloseAllWindows() -> Bool
  func performNewWindow() -> Bool
  func performQuit() -> Bool
  func performToggleVisibility() -> Bool
}

private final class WeakToggleVisibilityWindow {
  weak var value: NSWindow?

  init(_ value: NSWindow) {
    self.value = value
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, GhosttyAppActionPerforming {
  struct LaunchWindowRequest: Equatable {
    let session: TerminalWindowSession?
    let startupCommand: String?
  }

  @Shared(.supatermSettings)
  private var supatermSettings = .default
  @Shared(.lastAppLaunchedDate)
  private var lastAppLaunchedDate: Date?
  @Shared(.terminalSessionCatalog)
  private var sessionCatalog = TerminalSessionCatalog.default
  @Shared(.terminalPinnedTabCatalog)
  private var pinnedTabCatalog = TerminalPinnedTabCatalog.default

  private let menuController: SupatermMenuController
  private let globalKeybindManager: GhosttyGlobalKeybindManager
  private let quitConfirmationPresenter: QuitConfirmationPresenter
  private let socketStore: StoreOf<SocketControlFeature>
  private let terminalWindowRegistry: TerminalWindowRegistry
  private lazy var serviceProvider = SupatermServiceProvider(
    openTabs: { [weak self] paths in
      self?.openServiceTabs(workingDirectoryPaths: paths)
    },
    openWindows: { [weak self] paths in
      self?.openServiceWindows(workingDirectoryPaths: paths)
    }
  )
  private var settingsWindowController: SettingsWindowController?
  private var terminatingSessionCatalog: TerminalSessionCatalog?
  private var isTerminatingAfterSessionTermination = false
  private var toggleVisibilityState: ToggleVisibilityState?
  private var windowControllers: [UUID: TerminalWindowController] = [:]
  private var suppressesSessionSave = false

  private static let onboardingStartupCommand = #"sp onboard; exec "${SHELL:-/bin/zsh}" -l"#

  override init() {
    AppCrashReporting.setup()
    AppTelemetry.setup()
    GhosttyBootstrap.initialize()
    let terminalWindowRegistry = TerminalWindowRegistry()
    let terminalCommandExecutor = TerminalCommandExecutor(registry: terminalWindowRegistry)
    let menuController = SupatermMenuController(registry: terminalWindowRegistry)
    let globalKeybindManager = GhosttyGlobalKeybindManager.shared
    let quitConfirmationPresenter = QuitConfirmationPresenter()
    let socketStore = Store(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
    } withDependencies: {
      $0.socketRequestExecutor = .live(commandExecutor: terminalCommandExecutor)
    }
    self.menuController = menuController
    self.globalKeybindManager = globalKeybindManager
    self.quitConfirmationPresenter = quitConfirmationPresenter
    self.socketStore = socketStore
    self.terminalWindowRegistry = terminalWindowRegistry
    super.init()
    globalKeybindManager.setRuntimeProvider { [weak terminalWindowRegistry] in
      terminalWindowRegistry?.globalKeybindRuntimes() ?? []
    }
    terminalWindowRegistry.commandExecutor = terminalCommandExecutor
    terminalWindowRegistry.onChange = { [weak menuController, weak globalKeybindManager] in
      menuController?.refresh()
      globalKeybindManager?.refresh()
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
    NSApp.servicesProvider = serviceProvider
    menuController.install()
    socketStore.send(.task)
    refreshInstalledAgentHooks()
    restoreWindowsAtLaunch()
    reapOrphanZmxSessions()
    $lastAppLaunchedDate.withLock {
      $0 = Date()
    }
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    guard toggleVisibilityState == nil else { return }
    guard !NSApp.windows.contains(where: \.isVisible) else { return }
    _ = showExistingWindowOrCreate()
  }

  func applicationDidHide(_ notification: Notification) {
    if toggleVisibilityState == nil {
      toggleVisibilityState = ToggleVisibilityState()
    }
  }

  func applicationDidUnhide(_ notification: Notification) {
    if NSApp.windows.contains(where: \.isVisible) {
      toggleVisibilityState = nil
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    persistSession(
      Self.persistedSessionCatalog(
        liveSessionCatalog: terminalWindowRegistry.restorationSnapshot(),
        pendingTerminationSessionCatalog: terminatingSessionCatalog
      )
    )
    globalKeybindManager.disable()
    socketStore.send(.shutdown)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if flag { return true }
    return showExistingWindowOrCreate() ? false : true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if isTerminatingAfterSessionTermination {
      return .terminateNow
    }
    let reply = Self.terminateReply(
      hasVisibleAppWindows: NSApp.windows.contains(where: \.isVisible),
      confirmQuitMode: supatermSettings.confirmQuitMode,
      hasActiveAgentWorkForQuit: terminalWindowRegistry.hasActiveAgentWorkForQuit,
      needsQuitConfirmation: terminalWindowRegistry.needsQuitConfirmation,
      bypassesQuitConfirmation: terminalWindowRegistry.bypassesQuitConfirmation,
      terminatesSessionsOnQuit: supatermSettings.terminateSessionsOnQuit
    ) {
      quitConfirmationPresenter.confirmQuit(terminatesSessions: supatermSettings.terminateSessionsOnQuit)
    }
    terminatingSessionCatalog = Self.pendingTerminationSessionCatalog(
      for: reply,
      liveSessionCatalog: terminalWindowRegistry.restorationSnapshot(),
      terminatesSessionsOnQuit: supatermSettings.terminateSessionsOnQuit
    )
    if reply == .terminateNow && supatermSettings.terminateSessionsOnQuit {
      isTerminatingAfterSessionTermination = true
      Task { @MainActor in
        await terminalWindowRegistry.terminateLiveTerminalSessionsAndWait()
        await terminalWindowRegistry.terminateAllZmxSessionsAndWait()
        NSApp.reply(toApplicationShouldTerminate: true)
      }
      return .terminateLater
    }
    if reply == .terminateNow {
      terminalWindowRegistry.setTerminatesTerminalSessionsOnWindowClose(supatermSettings.terminateSessionsOnQuit)
    }
    return reply
  }

  @discardableResult
  func performNewWindow() -> Bool {
    let controller = createWindow()
    AppTelemetry.capture("window_created")
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
  func performToggleVisibility() -> Bool {
    if NSApp.isActive {
      if let keyWindow = NSApp.keyWindow,
        keyWindow.styleMask.contains(.fullScreen)
      {
        return false
      }
      toggleVisibilityState = ToggleVisibilityState()
      NSApp.hide(nil)
      return true
    }

    let state = toggleVisibilityState
    NSApp.activate(ignoringOtherApps: true)
    if let state {
      state.restore()
      toggleVisibilityState = nil
      return true
    }
    return showExistingWindowOrCreate()
  }

  @discardableResult
  func performShowSettings(tab: SettingsFeature.Tab) -> Bool {
    let sourceWindow = NSApp.keyWindow ?? NSApp.mainWindow
    let controller: SettingsWindowController
    if let settingsWindowController {
      controller = settingsWindowController
    } else {
      let createdController = SettingsWindowController()
      settingsWindowController = createdController
      controller = createdController
    }
    controller.show(tab: tab, relativeTo: sourceWindow)
    return true
  }

  @discardableResult
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
    menuController.performGhosttyBindingMenuKeyEquivalent(with: event)
  }

  private func restoreWindowsAtLaunch() {
    suppressesSessionSave = true
    let requests = Self.initialWindowRequests(
      from: sessionCatalog,
      restoreTerminalLayoutEnabled: supatermSettings.restoreTerminalLayoutEnabled,
      lastAppLaunchedDate: lastAppLaunchedDate
    )
    var lastController: TerminalWindowController?
    for request in requests {
      lastController = createWindow(
        session: request.session,
        startupCommand: request.startupCommand
      )
    }
    suppressesSessionSave = false
    saveSession()
    if let window = lastController?.window {
      NSApp.activate(ignoringOtherApps: true)
      window.makeKeyAndOrderFront(nil)
    }
  }

  private func refreshInstalledAgentHooks() {
    Task.detached {
      StartupAgentHookRefresher.live.refreshInstalledHooks()
    }
  }

  private func reapOrphanZmxSessions() {
    let zmxClient = ZmxClient.liveValue
    Task.detached(priority: .utility) {
      let sessionIDs = await zmxClient.listSessions()
      let knownSessionIDs = await MainActor.run { [weak self] in
        guard let self else { return Set<String>() }
        return Self.knownZmxSessionIDsForLaunchReaping(
          restoreTerminalLayoutEnabled: supatermSettings.restoreTerminalLayoutEnabled,
          sessionCatalog: sessionCatalog,
          pinnedTabCatalog: pinnedTabCatalog,
          liveSurfaceIDs: terminalWindowRegistry.liveSurfaceIDs()
        )
      }
      let orphanSurfaceIDs =
        sessionIDs
        .filter { !knownSessionIDs.contains($0) }
        .compactMap(ZmxSessionID.surfaceID(from:))
      await withTaskGroup(of: Void.self) { group in
        for surfaceID in orphanSurfaceIDs {
          group.addTask {
            await zmxClient.killSession(surfaceID)
          }
        }
      }
    }
  }

  static func knownZmxSessionIDsForLaunchReaping(
    restoreTerminalLayoutEnabled: Bool,
    sessionCatalog: TerminalSessionCatalog,
    pinnedTabCatalog: TerminalPinnedTabCatalog,
    liveSurfaceIDs: Set<UUID>
  ) -> Set<String> {
    let persistedSurfaceIDs =
      restoreTerminalLayoutEnabled
      ? sessionCatalog.surfaceIDs.union(pinnedTabCatalog.surfaceIDs)
      : []
    return Set(persistedSurfaceIDs.union(liveSurfaceIDs).map(ZmxSessionID.make(surfaceID:)))
  }

  private func openServiceTabs(workingDirectoryPaths: [String]) {
    guard let firstPath = workingDirectoryPaths.first else { return }
    NSApp.activate(ignoringOtherApps: true)

    guard terminalWindowRegistry.createTabInPreferredWindow(workingDirectoryPath: firstPath) else {
      let controller = createWindow()
      controller.terminal.ensureInitialTab(focusing: true, workingDirectoryPath: firstPath)
      controller.window?.makeKeyAndOrderFront(nil)
      for path in workingDirectoryPaths.dropFirst() {
        controller.terminal.createTab(focusing: true, workingDirectoryPath: path)
      }
      return
    }

    for path in workingDirectoryPaths.dropFirst() {
      terminalWindowRegistry.createTabInPreferredWindow(workingDirectoryPath: path)
    }
  }

  private func openServiceWindows(workingDirectoryPaths: [String]) {
    guard !workingDirectoryPaths.isEmpty else { return }
    NSApp.activate(ignoringOtherApps: true)

    for path in workingDirectoryPaths {
      let controller = createWindow()
      controller.terminal.ensureInitialTab(focusing: true, workingDirectoryPath: path)
      controller.window?.makeKeyAndOrderFront(nil)
    }
  }

  private func createWindow(
    session: TerminalWindowSession? = nil,
    startupCommand: String? = nil
  ) -> TerminalWindowController {
    let controller = TerminalWindowController(
      registry: terminalWindowRegistry,
      session: session,
      startupCommand: startupCommand
    ) { [weak self] in
      self?.saveSession()
    }
    controller.onWindowWillClose = { [weak self] controller in
      self?.windowControllers.removeValue(forKey: controller.windowControllerID)
      self?.saveSession()
    }
    windowControllers[controller.windowControllerID] = controller
    controller.showWindow(nil)
    saveSession()
    return controller
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

  private func saveSession() {
    guard
      Self.shouldSaveLiveSession(
        suppressesSessionSave: suppressesSessionSave,
        pendingTerminationSessionCatalog: terminatingSessionCatalog
      )
    else { return }
    persistSession(terminalWindowRegistry.restorationSnapshot())
  }

  private func persistSession(_ sessionCatalog: TerminalSessionCatalog) {
    $sessionCatalog.withLock {
      $0 = sessionCatalog
    }
  }

  static func initialWindowSessions(
    from sessionCatalog: TerminalSessionCatalog,
    restoreTerminalLayoutEnabled: Bool
  ) -> [TerminalWindowSession?] {
    guard restoreTerminalLayoutEnabled else {
      return [nil]
    }
    if sessionCatalog.windows.isEmpty {
      return [nil]
    }
    return sessionCatalog.windows.map(Optional.some)
  }

  static func initialWindowRequests(
    from sessionCatalog: TerminalSessionCatalog,
    restoreTerminalLayoutEnabled: Bool,
    lastAppLaunchedDate: Date?
  ) -> [LaunchWindowRequest] {
    let sessions = initialWindowSessions(
      from: sessionCatalog,
      restoreTerminalLayoutEnabled: restoreTerminalLayoutEnabled
    )
    let onboardingWindowIndex: Int?
    if lastAppLaunchedDate == nil {
      onboardingWindowIndex = sessions.firstIndex(where: { $0 == nil })
    } else {
      onboardingWindowIndex = nil
    }

    return sessions.enumerated().map { index, session in
      LaunchWindowRequest(
        session: session,
        startupCommand: index == onboardingWindowIndex ? onboardingStartupCommand : nil
      )
    }
  }

  static func terminateReply(
    hasVisibleAppWindows: Bool,
    confirmQuitMode: ConfirmQuitMode = .auto,
    hasActiveAgentWorkForQuit: Bool = false,
    needsQuitConfirmation: Bool,
    bypassesQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool = false,
    confirmQuit: () -> Bool
  ) -> NSApplication.TerminateReply {
    guard hasVisibleAppWindows else { return .terminateNow }
    guard !bypassesQuitConfirmation else { return .terminateNow }
    guard
      shouldConfirmQuit(
        mode: confirmQuitMode,
        hasActiveAgentWorkForQuit: hasActiveAgentWorkForQuit,
        needsQuitConfirmation: needsQuitConfirmation,
        terminatesSessionsOnQuit: terminatesSessionsOnQuit
      )
    else {
      return .terminateNow
    }
    return confirmQuit() ? .terminateNow : .terminateCancel
  }

  static func shouldConfirmQuit(
    mode: ConfirmQuitMode,
    hasActiveAgentWorkForQuit: Bool,
    needsQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool
  ) -> Bool {
    switch mode {
    case .always:
      return true
    case .never:
      return false
    case .auto:
      return hasActiveAgentWorkForQuit || needsQuitConfirmation || terminatesSessionsOnQuit
    }
  }

  static func pendingTerminationSessionCatalog(
    for reply: NSApplication.TerminateReply,
    liveSessionCatalog: TerminalSessionCatalog,
    terminatesSessionsOnQuit: Bool = false
  ) -> TerminalSessionCatalog? {
    guard reply == .terminateNow else { return nil }
    return terminatesSessionsOnQuit ? .default : liveSessionCatalog
  }

  static func persistedSessionCatalog(
    liveSessionCatalog: TerminalSessionCatalog,
    pendingTerminationSessionCatalog: TerminalSessionCatalog?
  ) -> TerminalSessionCatalog {
    pendingTerminationSessionCatalog ?? liveSessionCatalog
  }

  static func shouldSaveLiveSession(
    suppressesSessionSave: Bool,
    pendingTerminationSessionCatalog: TerminalSessionCatalog?
  ) -> Bool {
    !suppressesSessionSave && pendingTerminationSessionCatalog == nil
  }

  struct ToggleVisibilityState {
    private let hiddenWindows: [WeakToggleVisibilityWindow]
    private let keyWindow: WeakToggleVisibilityWindow?

    init(windows: [NSWindow] = NSApp.windows, keyWindow: NSWindow? = NSApp.keyWindow) {
      self.keyWindow = keyWindow.map(WeakToggleVisibilityWindow.init)
      var visibleWindows: [WeakToggleVisibilityWindow] = []
      for window in windows where window.isVisible && !window.styleMask.contains(.fullScreen) {
        let windowToHide = window.tabGroup?.selectedWindow ?? window
        if !visibleWindows.contains(where: { $0.value === windowToHide }) {
          visibleWindows.append(WeakToggleVisibilityWindow(windowToHide))
        }
      }
      self.hiddenWindows = visibleWindows
    }

    func restore() {
      for window in hiddenWindows {
        window.value?.orderFrontRegardless()
      }
      keyWindow?.value?.makeKey()
    }
  }
}
