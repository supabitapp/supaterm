import AppKit
import SupatermLicenseFeature
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
private final class HostUpdateLicenseState {
  var status: HostLicenseStatus?

  var access: LicenseAccess {
    guard
      let status,
      let licenseID = status.licenseID,
      let rawDay = status.updatesThrough,
      let updatesThrough = LicenseDay(rawDay)
    else {
      return .free
    }
    let ownership = LicenseOwnership(licenseID: licenseID, updatesThrough: updatesThrough)
    return status.mode == .paid ? .paid(ownership) : .expired(ownership)
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate,
  GhosttyAppActionPerforming
{
  private let configurationDiagnosticsWindowController = ConfigurationDiagnosticsWindowController()
  private let ghosttyRuntime: GhosttyRuntime
  private let globalKeybindManager: GhosttyGlobalKeybindManager
  private let hostWorkspaceController: HostWorkspaceApplicationController
  private let licenseState: HostUpdateLicenseState
  private let menuController = HostAppMenuController()
  private let updateClient: UpdateClient
  private lazy var serviceProvider = SupatermServiceProvider(
    openTabs: { [weak self] paths in
      self?.openServiceTabs(workingDirectoryPaths: paths)
    },
    openWindows: { [weak self] paths in
      self?.openServiceWindows(workingDirectoryPaths: paths)
    }
  )
  private var configurationDiagnosticsObserver: NSObjectProtocol?
  private var settingsWindowController: HostSettingsWindowController?
  private var shouldPresentLaunchConfigurationDiagnostics = true
  private var toggleVisibilityState: ToggleVisibilityState?

  override init() {
    AppPostHog.setup()
    let ghosttyRuntime = GhosttyRuntime()
    let host = HostWorkspaceApplicationController(ghosttyRuntime: ghosttyRuntime)
    let licenseState = HostUpdateLicenseState()
    let updateClient = UpdateClient.live(
      license: UpdateLicenseClient(
        access: { licenseState.access },
        refresh: {
          licenseState.status = try? await host.refreshLicense()
        }
      )
    )
    self.ghosttyRuntime = ghosttyRuntime
    globalKeybindManager = GhosttyGlobalKeybindManager(runtime: ghosttyRuntime)
    hostWorkspaceController = host
    self.licenseState = licenseState
    self.updateClient = updateClient
    super.init()
    globalKeybindManager.refresh()
  }

  isolated deinit {
    if let configurationDiagnosticsObserver {
      NotificationCenter.default.removeObserver(configurationDiagnosticsObserver)
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSWindow.allowsAutomaticWindowTabbing = false
    _ = NSPasteboard.ghosttySelection
    HostClientPreferences.applyAppearance()
    installConfigurationDiagnosticsObserver()
    NSApp.servicesProvider = serviceProvider
    UNUserNotificationCenter.current().delegate = self
    menuController.install()
    Task { [weak self] in
      guard let self else { return }
      do {
        try await hostWorkspaceController.start()
        licenseState.status = try await hostWorkspaceController.licenseStatus()
        await updateClient.start()
      } catch {
        present(error)
      }
    }
  }

  func applicationDidBecomeActive(_ notification: Notification) {
    AppPostHog.captureDebouncedLifecycleEvent(.activatedDebounced)
    Task { [weak self] in
      guard let self else { return }
      licenseState.status = try? await hostWorkspaceController.refreshLicense()
    }
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
    guard let key = urls.lazy.compactMap(Self.licenseKey).first else { return }
    Task { [weak self] in
      guard let self else { return }
      do {
        licenseState.status = try await hostWorkspaceController.activateLicense(key)
        _ = performShowSettings(tab: .license)
      } catch {
        present(error)
      }
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    AppPostHog.capture("app_quit")
    hostWorkspaceController.stop()
    globalKeybindManager.disable()
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
      let paneID = NotificationRequest.sourceSurfaceID(
        from: response.notification.request.content.userInfo
      )
    else { return }
    try? await hostWorkspaceController.focus(paneID: paneID)
  }

  @discardableResult
  func performNewWindow() -> Bool {
    Task { [weak self] in
      try? await self?.hostWorkspaceController.createWindow()
    }
    AppPostHog.capture("window_created")
    activateForWindowPresentation()
    return true
  }

  func performNewTab() {
    Task { [weak self] in
      try? await self?.hostWorkspaceController.createTab()
    }
    activateForWindowPresentation()
  }

  @discardableResult
  func performCloseAllWindows() -> Bool {
    hostWorkspaceController.closeAllWindows()
  }

  @discardableResult
  func performCheckForUpdates() -> Bool {
    Task { [updateClient] in
      await updateClient.perform(.checkForUpdates)
    }
    return true
  }

  @discardableResult
  func performQuit() -> Bool {
    NSApp.terminate(nil)
    return true
  }

  @discardableResult
  func performQuitTerminatingSessions() -> Bool {
    let alert = NSAlert()
    alert.messageText = "End all terminals and quit?"
    alert.informativeText = "This ends every process owned by this Supaterm host."
    alert.addButton(withTitle: "End All and Quit")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else { return false }
    Task { [weak self] in
      guard let self else { return }
      do {
        try await hostWorkspaceController.terminateAll()
        NSApp.terminate(nil)
      } catch {
        present(error)
      }
    }
    return true
  }

  @discardableResult
  func performToggleVisibility() -> Bool {
    if NSApp.isActive {
      if let keyWindow = NSApp.keyWindow, keyWindow.styleMask.contains(.fullScreen) {
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
  func performShowSettings(tab: HostSettingsTab) -> Bool {
    let controller: HostSettingsWindowController
    if let settingsWindowController {
      controller = settingsWindowController
    } else {
      let created = HostSettingsWindowController(
        host: hostWorkspaceController,
        checkForUpdates: { [weak self] in _ = self?.performCheckForUpdates() }
      )
      settingsWindowController = created
      controller = created
    }
    controller.show(tab: tab)
    return true
  }

  @discardableResult
  func performBuyLicense() -> Bool {
    performShowSettings(tab: .license)
  }

  @discardableResult
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool {
    menuController.performKeyEquivalent(with: event)
  }

  private func installConfigurationDiagnosticsObserver() {
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

  private func openServiceTabs(workingDirectoryPaths: [String]) {
    guard !workingDirectoryPaths.isEmpty else { return }
    activateForWindowPresentation()
    Task { [weak self] in
      for path in workingDirectoryPaths {
        try? await self?.hostWorkspaceController.createTab(workingDirectory: path)
      }
    }
  }

  private func openServiceWindows(workingDirectoryPaths: [String]) {
    guard !workingDirectoryPaths.isEmpty else { return }
    activateForWindowPresentation()
    Task { [weak self] in
      for path in workingDirectoryPaths {
        try? await self?.hostWorkspaceController.createWindow(workingDirectory: path)
      }
    }
  }

  private func showExistingWindowOrCreate() -> Bool {
    if hostWorkspaceController.showExistingWindow() {
      activateForWindowPresentation()
      return true
    }
    return performNewWindow()
  }

  private func activateForWindowPresentation() {
    guard !AppBuild.isTestMode else { return }
    NSApp.activate(ignoringOtherApps: true)
  }

  private func present(_ error: any Error) {
    let alert = NSAlert(error: error)
    if let window = NSApp.keyWindow ?? NSApp.mainWindow {
      alert.beginSheetModal(for: window)
    } else {
      alert.runModal()
    }
  }

  private static func licenseKey(from url: URL) -> String? {
    guard
      url.scheme?.lowercased() == "supaterm",
      url.host?.lowercased() == "activate",
      url.path.isEmpty || url.path == "/",
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return nil }
    let keys = components.queryItems?.filter { $0.name == "key" }.compactMap(\.value) ?? []
    return keys.count == 1 ? keys[0] : nil
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
      hiddenWindows = visibleWindows
    }

    func restore() {
      for window in hiddenWindows {
        window.value?.orderFrontRegardless()
      }
      keyWindow?.value?.makeKey()
    }
  }
}
