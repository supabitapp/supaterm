import AppKit
import ComposableArchitecture
import Sharing
import SupatermCLIShared
import SupatermLicenseFeature
import SupatermSettingsFeature
import SupatermSocketFeature
import SupatermSupport
import SupatermUpdateFeature
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
  private struct LicenseSystem {
    let licenseStore: StoreOf<LicenseFeature>
    let updateClient: UpdateClient
    let updateStore: StoreOf<UpdateFeature>
  }

  @Shared(.supatermSettings)
  private var supatermSettings = .default
  @Shared(.lastAppLaunchedDate)
  private var lastAppLaunchedDate: Date?
  @Shared(.terminalSessionCatalog)
  private var sessionCatalog = TerminalSessionCatalog.default
  @Shared(.terminalSpaceCatalog)
  private var spaceCatalog = TerminalSpaceCatalog.default

  private let menuController: SupatermMenuController
  private let appProcess: Shared<AppFeature.ProcessState>
  private let appStore: StoreOf<AppFeature>
  private let agentDetectionRuleRepository: AgentDetectionRuleRepository?
  private let configurationDiagnosticsWindowController = ConfigurationDiagnosticsWindowController()
  private let globalKeybindManager: GhosttyGlobalKeybindManager
  private let ghosttyRuntime: GhosttyRuntime
  private let licenseStore: StoreOf<LicenseFeature>
  private let quitConfirmationPresenter: QuitConfirmationPresenter
  private let terminalWindowRegistry: TerminalWindowRegistry
  private let tabNewWindowDropController: TerminalTabNewWindowDropController
  private let updateClient: UpdateClient
  private let updateStore: StoreOf<UpdateFeature>
  private let zmxSessionsEnabledAtLaunch: Bool
  private lazy var serviceProvider = SupatermServiceProvider(
    openTabs: { [weak self] paths in
      self?.openServiceTabs(workingDirectoryPaths: paths)
    },
    openWindows: { [weak self] paths in
      self?.openServiceWindows(workingDirectoryPaths: paths)
    }
  )
  private let sessionCatalogWasRejectedAtLaunch = TerminalSessionCatalog.storedCatalogWasRejected()
  private var settingsWindowController: SettingsWindowController?
  private var configurationDiagnosticsObserver: NSObjectProtocol?
  private var bypassesConfirmationForNextQuit = false
  private var shouldPresentLaunchConfigurationDiagnostics = true
  private var sessionPersistenceState = SessionPersistenceState.active
  private var terminatesSessionsForNextQuit = false
  private var toggleVisibilityState: ToggleVisibilityState?
  private var windowControllers: [UUID: TerminalWindowController] = [:]

  private static func onboardingStartup(cliPath: String?) -> SupatermTerminalStartup? {
    guard let cliPath, let socketPath = SupatermProcessSocketEndpoint.current()?.path else {
      return nil
    }
    return .shell(
      SupatermShellCommand.escapedCommand([cliPath, "onboard", "--socket", socketPath])
    )
  }

  override init() {
    AppPostHog.setup()
    let ghosttyRuntime = GhosttyRuntime()
    @Shared(.supatermSettings) var launchSupatermSettings = .default
    SupatermLog.setVerboseLoggingEnabled(launchSupatermSettings.verboseLoggingEnabled)
    let zmxSessionsEnabledAtLaunch = ZmxEnvironment.sessionsEnabled(
      setting: launchSupatermSettings.zmxSessionsEnabled
    )
    let zmxClient = zmxSessionsEnabledAtLaunch ? ZmxClient.live : .noop
    let licenseSystem = Self.makeLicenseSystem()
    let appProcess = Shared(value: AppFeature.ProcessState())
    let terminalWindowRegistry = TerminalWindowRegistry(
      zmxClient: zmxClient,
      licenseStore: licenseSystem.licenseStore,
      updateStore: licenseSystem.updateStore,
      ghosttyShortcutForAction: ghosttyRuntime.shortcut(forAction:)
    )
    let tabNewWindowDropController = TerminalTabNewWindowDropController(
      tabDragRegistry: terminalWindowRegistry.tabDragRegistry
    )
    let agentDetectionRuleRepository = Self.makeAgentDetectionRuleRepository()
    let terminalCommandExecutor = TerminalCommandExecutor(
      registry: terminalWindowRegistry,
      agentDetectionRuleRepository: agentDetectionRuleRepository
    )
    let menuController = SupatermMenuController(registry: terminalWindowRegistry)
    let globalKeybindManager = GhosttyGlobalKeybindManager(runtime: ghosttyRuntime)
    let quitConfirmationPresenter = QuitConfirmationPresenter()
    let appStore = Store(initialState: AppFeature.State(process: appProcess)) {
      AppFeature()
    } withDependencies: {
      Self.configureAnalytics(&$0)
      $0.socketRequestExecutor = .live(commandExecutor: terminalCommandExecutor)
    }
    self.appProcess = appProcess
    self.appStore = appStore
    self.agentDetectionRuleRepository = agentDetectionRuleRepository
    self.menuController = menuController
    self.globalKeybindManager = globalKeybindManager
    self.ghosttyRuntime = ghosttyRuntime
    self.licenseStore = licenseSystem.licenseStore
    self.quitConfirmationPresenter = quitConfirmationPresenter
    self.terminalWindowRegistry = terminalWindowRegistry
    self.tabNewWindowDropController = tabNewWindowDropController
    self.updateClient = licenseSystem.updateClient
    self.updateStore = licenseSystem.updateStore
    self.zmxSessionsEnabledAtLaunch = zmxSessionsEnabledAtLaunch
    super.init()
    globalKeybindManager.refresh()
    terminalWindowRegistry.tabDragRegistry.detach = { [weak self] payload, frame in
      self?.detachTab(payload, previewFrame: frame) == true
    }
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

  private static func makeLicenseSystem() -> LicenseSystem {
    let runtime = LicenseRuntime.live {
      AppPostHog.capture("license_refresh_revoked")
      guard let appDelegate = NSApp.delegate as? AppDelegate else {
        preconditionFailure("App delegate must exist before license refresh completes")
      }
      _ = appDelegate.performShowSettings(tab: .license)
    }
    let updateClient = UpdateClient.live(
      license: UpdateLicenseClient(
        access: {
          runtime.access(releaseDay: AppBuild.releaseDay)
        },
        refresh: {
          try? await runtime.refreshAndApply()
        }
      )
    )
    let appStore = Store(initialState: AppLicenseFeature.State(runtime: runtime)) {
      AppLicenseFeature(runtime: runtime)
    } withDependencies: {
      configureAnalytics(&$0)
      $0.updateClient = updateClient
    }
    let updateStore = Store(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      configureAnalytics(&$0)
      $0.updateClient = updateClient
    }
    return LicenseSystem(
      licenseStore: appStore.scope(state: \.license, action: \.license),
      updateClient: updateClient,
      updateStore: updateStore
    )
  }

  private static func configureAnalytics(_ dependencies: inout DependencyValues) {
    dependencies.analyticsClient.capture = { event in
      Task { @MainActor in
        AppPostHog.capture(event)
      }
    }
    dependencies.analyticsClient.captureProperties = { event, properties in
      Task { @MainActor in
        AppPostHog.capture(event, properties: properties)
      }
    }
  }

  isolated deinit {
    tabNewWindowDropController.stop()
    if let configurationDiagnosticsObserver {
      NotificationCenter.default.removeObserver(configurationDiagnosticsObserver)
    }
  }

  private var launchZmxClient: ZmxClient {
    zmxSessionsEnabledAtLaunch ? .live : .noop
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
    _ = NSPasteboard.ghosttySelection
    installConfigurationDiagnosticsObserver()
    NSApp.servicesProvider = serviceProvider
    UNUserNotificationCenter.current().delegate = self
    menuController.install()
    licenseStore.send(.task)
    updateStore.send(.task)
    appStore.send(.task)
    repairAgentIntegrations()
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
    licenseStore.send(.applicationBecameActive)
    if shouldPresentLaunchConfigurationDiagnostics {
      shouldPresentLaunchConfigurationDiagnostics = false
      refreshConfigurationDiagnostics()
    }
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

  func application(_ application: NSApplication, open urls: [URL]) {
    guard let key = urls.lazy.compactMap(LicenseActivationURL.key(from:)).first else { return }
    licenseStore.send(.activationLinkOpened(key))
    _ = performShowSettings(tab: .license)
  }

  func applicationWillTerminate(_ notification: Notification) {
    AppPostHog.capture("app_quit")
    persistSession(
      sessionPersistenceState.catalogToPersist(
        liveCatalog: terminalWindowRegistry.restorationSnapshot()
      )
    )
    globalKeybindManager.disable()
    licenseStore.send(.shutdown)
    updateStore.send(.shutdown)
    appStore.send(.shutdown)
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
    var options: UNNotificationPresentationOptions = [.badge, .banner]
    if notification.request.content.sound != nil {
      options.insert(.sound)
    }
    return options
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
    let terminalWindow = terminalWindowRegistry.preferredTerminalWindow
    let terminationPlan = Self.terminationPlan(
      hasTerminalWindow: terminalWindow != nil,
      bypassesQuitConfirmation: terminatesSessionsForNextQuit
        || bypassesConfirmationForNextQuit
        || terminalWindowRegistry.bypassesQuitConfirmation,
      terminatesSessionsOnQuit: terminatesSessionsOnQuit
    ) {
      guard let terminalWindow else { return .cancel }
      return quitConfirmationPresenter.confirmQuit(
        parentWindow: terminalWindow,
        terminatesSessions: terminatesSessionsOnQuit
      )
    }
    let reply = terminationPlan.reply
    sessionPersistenceState = .afterTerminationDecision(
      reply: reply,
      terminatesSessions: terminationPlan.terminatesSessions,
      liveCatalog: terminalWindowRegistry.restorationSnapshot()
    )
    if reply == .terminateNow && terminationPlan.terminatesSessions {
      Task { @MainActor in
        await terminalWindowRegistry.terminateTerminalSessionsAndWait()
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
    let controller = createWindow(
      launch: .newShell(
        spaceID: terminalWindowRegistry.preferredSpaceID ?? spaceCatalog.defaultSelectedSpaceID,
        startupCommand: nil
      )
    )
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
      let createdController = SettingsWindowController(
        updateClient: updateClient,
        menuController: menuController,
        licenseStore: licenseStore
      )
      settingsWindowController = createdController
      controller = createdController
    }
    controller.show(tab: tab, relativeTo: sourceWindow)
    return true
  }

  @discardableResult
  func performBuyLicense() -> Bool {
    licenseStore.send(.buyButtonTapped)
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
      validSpaceIDs: Set(spaceCatalog.spaces.map(\.id)),
      restoreTerminalLayoutEnabled: supatermSettings.restoreTerminalLayoutEnabled,
      allowsExistingSessions:
        zmxSessionsEnabledAtLaunch && launchZmxClient.executableURL() != nil,
      lastAppLaunchedDate: lastAppLaunchedDate,
      cliPath: GhosttySupport.bundledCLIPath(executableURL: Bundle.main.executableURL)
    )
    var lastController: TerminalWindowController?
    for request in requests {
      lastController = createWindow(launch: request)
    }
    sessionPersistenceState = .active
    saveSession()
    if let window = lastController?.window {
      activateForWindowPresentation()
      window.makeKeyAndOrderFront(nil)
    }
  }

  private func repairAgentIntegrations() {
    Task.detached {
      StartupAgentIntegrationRefresher.live.repairIntegrations()
    }
  }

  private func reapOrphanZmxSessions() {
    guard !sessionCatalogWasRejectedAtLaunch else {
      SupatermLog.notice(
        SupatermLog.zmx,
        "zmx.reap.skipped",
        fields: ["reason=sessionCatalogRejected"]
      )
      return
    }
    let zmxClient = launchZmxClient
    Task.detached(priority: .utility) {
      SupatermLog.debug(SupatermLog.zmx, "zmx.reap.start")
      guard let sessions = await zmxClient.listSessions() else {
        SupatermLog.error(SupatermLog.zmx, "zmx.reap.skipped", fields: ["reason=listFailed"])
        return
      }
      let knownSurfaceIDs = await MainActor.run { [weak self] in
        guard let self else { return Set<UUID>() }
        return Self.knownZmxSurfaceIDsForLaunchReaping(
          restoreTerminalLayoutEnabled: supatermSettings.restoreTerminalLayoutEnabled,
          sessionCatalog: sessionCatalog,
          liveSurfaceIDs: terminalWindowRegistry.liveSurfaceIDs()
        )
      }
      let orphanSessions = sessions.filter {
        !knownSurfaceIDs.contains($0.surfaceID)
      }
      let orphanSessionIDs = orphanSessions.map {
        ZmxSessionID.make(surfaceID: $0.surfaceID)
      }
      let orphanSurfaceIDs = orphanSessions.map(\.surfaceID)
      SupatermLog.debug(
        SupatermLog.zmx,
        "zmx.reap.plan",
        fields: [
          "sessions=\(sessions.count)",
          "known=\(knownSurfaceIDs.count)",
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

  static func knownZmxSurfaceIDsForLaunchReaping(
    restoreTerminalLayoutEnabled: Bool,
    sessionCatalog: TerminalSessionCatalog,
    liveSurfaceIDs: Set<UUID>
  ) -> Set<UUID> {
    let persistedSurfaceIDs =
      restoreTerminalLayoutEnabled
      ? sessionCatalog.surfaceIDs
      : []
    return persistedSurfaceIDs.union(liveSurfaceIDs)
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
    launch: TerminalWindowLaunch = .newShell(spaceID: nil, startupCommand: nil),
    ordersFront: Bool = true
  ) -> TerminalWindowController {
    let controller = TerminalWindowController(
      runtime: ghosttyRuntime,
      registry: terminalWindowRegistry,
      process: appProcess,
      launch: launch,
      zmxClient: launchZmxClient,
      zmxSessionsEnabled: zmxSessionsEnabledAtLaunch,
      agentDetectionRuleRepository: agentDetectionRuleRepository
    ) { [weak self] in
      self?.saveSession()
    }
    controller.onWindowWillClose = { [weak self] controller in
      self?.windowControllers.removeValue(forKey: controller.windowControllerID)
      self?.saveSession()
    }
    windowControllers[controller.windowControllerID] = controller
    if ordersFront {
      controller.window?.orderFront(nil)
    }
    saveSession()
    return controller
  }

  private func detachTab(
    _ payload: TerminalTabDragPayload,
    previewFrame: CGRect
  ) -> Bool {
    guard spaceCatalog.spaces.contains(where: { $0.id == payload.sourceSpaceID }) else {
      return false
    }
    let controller = createWindow(
      launch: .tabTransferDestination(spaceID: payload.sourceSpaceID),
      ordersFront: false
    )
    guard
      let expectedTopologyRevision = controller.terminal.spaceManager.tabCollection(
        for: payload.sourceSpaceID
      )?.topologyRevision
    else {
      controller.window?.close()
      return false
    }
    let destination = TerminalTabDragRegistry.Destination(
      windowControllerID: controller.windowControllerID,
      spaceID: payload.sourceSpaceID,
      expectedTopologyRevision: expectedTopologyRevision,
      placement: .root(TerminalRootPlacement(isPinned: false, index: 0))
    )
    guard terminalWindowRegistry.transferTab(payload, to: destination) != nil else {
      controller.window?.close()
      return false
    }
    if let window = controller.window {
      let previewCenter = CGPoint(x: previewFrame.midX, y: previewFrame.midY)
      let visibleFrame =
        NSScreen.screens.first(where: { $0.frame.contains(previewCenter) })?.visibleFrame
        ?? NSScreen.main?.visibleFrame
        ?? window.frame
      window.setFrame(
        TerminalTabNewWindowLayout.frame(
          previewFrame: previewFrame,
          windowSize: window.frame.size,
          visibleFrame: visibleFrame
        ),
        display: false
      )
      activateForWindowPresentation()
      window.makeKeyAndOrderFront(nil)
    }
    AppPostHog.capture("window_created")
    return true
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

  private static func makeAgentDetectionRuleRepository() -> AgentDetectionRuleRepository? {
    do {
      let repository = try AgentDetectionRuleRepository(
        bundle: .module,
        overrideDirectoryURL: SupatermStateRoot.directoryURL()
          .appendingPathComponent("agent-detection", isDirectory: true),
        fallsBackToBundledRules: true
      )
      if let error = repository.startupFallbackErrorDescription {
        SupatermLog.error(
          SupatermLog.terminal,
          "agent_detection.rules.bootstrap",
          fields: [
            "origin=local",
            "result=fallback",
            "error=\(error)",
          ]
        )
      }
      return repository
    } catch {
      SupatermLog.error(
        SupatermLog.terminal,
        "agent_detection.rules.bootstrap",
        fields: [
          "origin=embedded",
          "result=disabled",
          "error=\(String(reflecting: type(of: error)))",
        ]
      )
      return nil
    }
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

  static func initialWindowRequests(
    from sessionCatalog: TerminalSessionCatalog,
    validSpaceIDs: Set<TerminalSpaceID>,
    restoreTerminalLayoutEnabled: Bool,
    allowsExistingSessions: Bool = true,
    lastAppLaunchedDate: Date?,
    cliPath: String?
  ) -> [TerminalWindowLaunch] {
    if restoreTerminalLayoutEnabled {
      let windows = sessionCatalog.pruned(
        validSpaceIDs: validSpaceIDs,
        allowsExistingSessions: allowsExistingSessions
      ).windows
      if !windows.isEmpty {
        return windows.map(TerminalWindowLaunch.restore)
      }
      if !allowsExistingSessions,
        sessionCatalog.pruned(validSpaceIDs: validSpaceIDs).windows.contains(
          where: \.containsExistingSession
        )
      {
        return []
      }
    }
    return [
      .newShell(
        spaceID: nil,
        startupCommand: lastAppLaunchedDate == nil ? onboardingStartup(cliPath: cliPath) : nil
      )
    ]
  }

  struct TerminationPlan {
    let reply: NSApplication.TerminateReply
    let terminatesSessions: Bool
  }

  static func terminationPlan(
    hasTerminalWindow: Bool,
    bypassesQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool = false,
    confirmQuit: () -> QuitConfirmationDecision
  ) -> TerminationPlan {
    let defaultPlan = TerminationPlan(reply: .terminateNow, terminatesSessions: terminatesSessionsOnQuit)
    guard hasTerminalWindow else { return defaultPlan }
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
