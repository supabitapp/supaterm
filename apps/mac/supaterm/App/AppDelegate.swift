import AppKit
import ComposableArchitecture
import Sharing
import SupatermCLIShared
import SupatermSettingsFeature
import SupatermSocketFeature
import SupatermSupport
import UserNotifications

@MainActor
protocol GhosttyAppActionPerforming: AnyObject {
  func performCheckForUpdates() -> Bool
  func performCloseAllWindows() -> Bool
  func performNewWindow() -> Bool
  func performQuit() -> Bool
  func performQuitTerminatingSessions() -> Bool
  func performToggleVisibility() -> Bool
}

private final class WeakToggleVisibilityWindow {
  weak var value: NSWindow?

  init(_ value: NSWindow) {
    self.value = value
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate,
  GhosttyAppActionPerforming
{
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
  private let configurationDiagnosticsWindowController = ConfigurationDiagnosticsWindowController()
  private let globalKeybindManager: GhosttyGlobalKeybindManager
  private let ghosttyRuntime: GhosttyRuntime
  private let quitConfirmationPresenter: QuitConfirmationPresenter
  private let socketStore: StoreOf<SocketControlFeature>
  private let terminalWindowRegistry: TerminalWindowRegistry
  private let zmxSessionsEnabledAtLaunch: Bool
  private lazy var serviceProvider = SupatermServiceProvider(
    openTabs: { [weak self] paths in
      self?.openServiceTabs(workingDirectoryPaths: paths)
    },
    openWindows: { [weak self] paths in
      self?.openServiceWindows(workingDirectoryPaths: paths)
    }
  )
  private var settingsWindowController: SettingsWindowController?
  private var configurationDiagnosticsObserver: NSObjectProtocol?
  private var bypassesConfirmationForNextQuit = false
  private var sessionPersistenceState = SessionPersistenceState.active
  private var terminatesSessionsForNextQuit = false
  private var toggleVisibilityState: ToggleVisibilityState?
  private var windowControllers: [UUID: TerminalWindowController] = [:]

  private static var onboardingStartupCommand: String {
    SupatermShellCommand.interactiveStartupCommand(for: "sp onboard")
  }

  override init() {
    AppPostHog.setup()
    let ghosttyRuntime = GhosttyRuntime()
    @Shared(.supatermSettings) var launchSupatermSettings = .default
    SupatermLog.setVerboseLoggingEnabled(launchSupatermSettings.verboseLoggingEnabled)
    let zmxSessionsEnabledAtLaunch = launchSupatermSettings.zmxSessionsEnabled
    let zmxClient = zmxSessionsEnabledAtLaunch ? ZmxClient.live : .noop
    let terminalWindowRegistry = TerminalWindowRegistry(zmxClient: zmxClient)
    let terminalCommandExecutor = TerminalCommandExecutor(registry: terminalWindowRegistry)
    let menuController = SupatermMenuController(registry: terminalWindowRegistry)
    let globalKeybindManager = GhosttyGlobalKeybindManager(runtime: ghosttyRuntime)
    let quitConfirmationPresenter = QuitConfirmationPresenter()
    let socketStore = Store(initialState: SocketControlFeature.State()) {
      SocketControlFeature()
        .logActions()
    } withDependencies: {
      $0.socketRequestExecutor = .live(commandExecutor: terminalCommandExecutor)
    }
    self.menuController = menuController
    self.globalKeybindManager = globalKeybindManager
    self.ghosttyRuntime = ghosttyRuntime
    self.quitConfirmationPresenter = quitConfirmationPresenter
    self.socketStore = socketStore
    self.terminalWindowRegistry = terminalWindowRegistry
    self.zmxSessionsEnabledAtLaunch = zmxSessionsEnabledAtLaunch
    super.init()
    globalKeybindManager.refresh()
    terminalWindowRegistry.commandExecutor = terminalCommandExecutor
    terminalCommandExecutor.onQuitRequested = { [weak self] in
      self?.performSocketQuit()
    }
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

  isolated deinit {
    if let configurationDiagnosticsObserver {
      NotificationCenter.default.removeObserver(configurationDiagnosticsObserver)
    }
  }

  private var launchZmxClient: ZmxClient {
    zmxSessionsEnabledAtLaunch ? .live : .noop
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
    installConfigurationDiagnosticsObserver()
    refreshConfigurationDiagnostics()
    NSApp.servicesProvider = serviceProvider
    UNUserNotificationCenter.current().delegate = self
    menuController.install()
    socketStore.send(.task)
    refreshInstalledAgentHooks()
    #if SUPATERM_DEMO
      DemoSeed.seedCatalogs()
    #endif
    restoreWindowsAtLaunch()
    #if SUPATERM_DEMO
      DemoSeed.decorate(windowControllers.values.map(\.terminal))
    #endif
    if zmxSessionsEnabledAtLaunch {
      reapOrphanZmxSessions()
    }
    $lastAppLaunchedDate.withLock {
      $0 = Date()
    }
  }

  private func installConfigurationDiagnosticsObserver() {
    guard configurationDiagnosticsObserver == nil else { return }
    configurationDiagnosticsObserver = NotificationCenter.default.addObserver(
      forName: .ghosttyRuntimeConfigDidChange,
      object: ghosttyRuntime,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.refreshConfigurationDiagnostics()
      }
    }
  }

  private func refreshConfigurationDiagnostics() {
    configurationDiagnosticsWindowController.update(
      messages: ghosttyRuntime.configurationDiagnostics()
    )
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    AppPostHog.captureDebouncedLifecycleEvent(.activatedDebounced)
    guard toggleVisibilityState == nil else { return }
    guard !NSApp.windows.contains(where: \.isVisible) else { return }
    _ = showExistingWindowOrCreate()
  }

  func applicationDidResignActive(_ notification: Notification) {
    AppPostHog.captureDebouncedLifecycleEvent(.deactivatedDebounced)
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
    AppPostHog.capture("app_quit")
    persistSession(
      sessionPersistenceState.catalogToPersist(
        liveCatalog: terminalWindowRegistry.restorationSnapshot()
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

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    await Task.yield()
    return [.badge, .sound, .banner]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { return }
    guard
      let surfaceID = DesktopNotificationRequest.sourceSurfaceID(
        from: response.notification.request.content.userInfo
      )
    else {
      return
    }
    await MainActor.run {
      _ = self.terminalWindowRegistry.focusNotificationSurface(surfaceID)
    }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if sessionPersistenceState.shortCircuitsTerminateReply {
      return .terminateNow
    }
    let terminatesSessionsForNextQuit = self.terminatesSessionsForNextQuit
    self.terminatesSessionsForNextQuit = false
    let bypassesConfirmationForNextQuit = self.bypassesConfirmationForNextQuit
    self.bypassesConfirmationForNextQuit = false
    let terminatesSessionsOnQuit = terminatesSessionsForNextQuit || supatermSettings.terminatesSessionsOnQuit
    let terminationPlan = Self.terminationPlan(
      hasVisibleAppWindows: NSApp.windows.contains(where: \.isVisible),
      bypassesQuitConfirmation: terminatesSessionsForNextQuit
        || bypassesConfirmationForNextQuit
        || terminalWindowRegistry.bypassesQuitConfirmation,
      terminatesSessionsOnQuit: terminatesSessionsOnQuit
    ) {
      quitConfirmationPresenter.confirmQuit(terminatesSessions: terminatesSessionsOnQuit)
    }
    let reply = terminationPlan.reply
    sessionPersistenceState = .afterTerminationDecision(
      reply: reply,
      terminatesSessions: terminationPlan.terminatesSessions,
      liveCatalog: terminalWindowRegistry.restorationSnapshot()
    )
    if reply == .terminateNow && terminationPlan.terminatesSessions {
      Task { @MainActor in
        await terminalWindowRegistry.terminateLiveTerminalSessionsAndWait()
        await terminalWindowRegistry.terminateAllZmxSessionsAndWait()
        NSApp.reply(toApplicationShouldTerminate: true)
      }
      return .terminateLater
    }
    if reply == .terminateNow {
      terminalWindowRegistry.setTerminatesTerminalSessionsOnWindowClose(terminationPlan.terminatesSessions)
    }
    return reply
  }

  private func activateForWindowPresentation() {
    guard !AppBuild.isTestMode else { return }
    NSApp.activate(ignoringOtherApps: true)
  }

  private func performSocketQuit() {
    bypassesConfirmationForNextQuit = true
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(200)) {
      NSApp.terminate(nil)
    }
  }

  @discardableResult
  func performNewWindow() -> Bool {
    let controller = createWindow()
    AppPostHog.capture("window_created")
    activateForWindowPresentation()
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
  func performQuitTerminatingSessions() -> Bool {
    terminatesSessionsForNextQuit = true
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
    activateForWindowPresentation()
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
    sessionPersistenceState = .restoring
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
    sessionPersistenceState = .active
    saveSession()
    if let window = lastController?.window {
      activateForWindowPresentation()
      window.makeKeyAndOrderFront(nil)
    }
  }

  private func refreshInstalledAgentHooks() {
    Task.detached {
      StartupAgentHookRefresher.live.refreshInstalledHooks()
    }
  }

  private func reapOrphanZmxSessions() {
    let zmxClient = launchZmxClient
    Task.detached(priority: .utility) {
      SupatermLog.debug(SupatermLog.zmx, "zmx.reap.start")
      guard let sessionIDs = await zmxClient.listSessions() else {
        SupatermLog.error(SupatermLog.zmx, "zmx.reap.skipped", fields: ["reason=listFailed"])
        return
      }
      let knownSessionIDs = await MainActor.run { [weak self] in
        guard let self else { return Set<String>() }
        return Self.knownZmxSessionIDsForLaunchReaping(
          restoreTerminalLayoutEnabled: supatermSettings.restoreTerminalLayoutEnabled,
          sessionCatalog: sessionCatalog,
          pinnedTabCatalog: pinnedTabCatalog,
          liveSurfaceIDs: terminalWindowRegistry.liveSurfaceIDs()
        )
      }
      let orphanSessionIDs =
        sessionIDs
        .filter { !knownSessionIDs.contains($0) }
      let orphanSurfaceIDs =
        orphanSessionIDs
        .compactMap { ZmxSessionID.surfaceID(from: $0) }
      SupatermLog.debug(
        SupatermLog.zmx,
        "zmx.reap.plan",
        fields: [
          "sessions=\(sessionIDs.count)",
          "known=\(knownSessionIDs.count)",
          "orphans=\(orphanSessionIDs.count)",
          "orphanSessionIDs=\(orphanSessionIDs.joined(separator: ","))",
        ]
      )
      await withTaskGroup(of: Void.self) { group in
        for surfaceID in orphanSurfaceIDs {
          group.addTask {
            await zmxClient.killSession(surfaceID)
          }
        }
      }
      SupatermLog.debug(
        SupatermLog.zmx,
        "zmx.reap.finished",
        fields: ["killed=\(orphanSurfaceIDs.count)"]
      )
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
      ? sessionCatalog.surfaceIDs
      : []
    let knownSurfaceIDs = persistedSurfaceIDs.union(pinnedTabCatalog.surfaceIDs).union(liveSurfaceIDs)
    return Set(knownSurfaceIDs.map { ZmxSessionID.make(surfaceID: $0) })
  }

  private func openServiceTabs(workingDirectoryPaths: [String]) {
    guard let firstPath = workingDirectoryPaths.first else { return }
    activateForWindowPresentation()

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
    activateForWindowPresentation()

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
      runtime: ghosttyRuntime,
      registry: terminalWindowRegistry,
      session: session,
      startupCommand: startupCommand,
      zmxClient: launchZmxClient,
      zmxSessionsEnabled: zmxSessionsEnabledAtLaunch
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
      activateForWindowPresentation()
      window.makeKeyAndOrderFront(nil)
      return true
    }
    return performNewWindow()
  }

  private func saveSession() {
    guard sessionPersistenceState.allowsLiveSave else { return }
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

  struct TerminationPlan {
    let reply: NSApplication.TerminateReply
    let terminatesSessions: Bool
  }

  static func terminationPlan(
    hasVisibleAppWindows: Bool,
    bypassesQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool = false,
    confirmQuit: () -> QuitConfirmationDecision
  ) -> TerminationPlan {
    let defaultPlan = TerminationPlan(reply: .terminateNow, terminatesSessions: terminatesSessionsOnQuit)
    guard hasVisibleAppWindows else { return defaultPlan }
    guard !bypassesQuitConfirmation else { return defaultPlan }
    switch confirmQuit() {
    case .cancel:
      return TerminationPlan(reply: .terminateCancel, terminatesSessions: false)
    case .quitPreservingSessions:
      return TerminationPlan(reply: .terminateNow, terminatesSessions: false)
    case .quitTerminatingSessions:
      return TerminationPlan(reply: .terminateNow, terminatesSessions: true)
    }
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
