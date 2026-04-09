import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SettingsFeatureTests {
  @Test
  func initialStateStartsOnGeneralTab() {
    let state = SettingsFeature.State()

    #expect(state.selectedTab == .general)
  }

  @Test
  func tabOrderEndsWithAbout() {
    #expect(
      SettingsFeature.Tab.allCases
        == [.general, .terminal, .notifications, .codingAgents, .about]
    )
  }

  @Test
  func taskLoadsPersistedSettings() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0 = SupatermSettings(
          appearanceMode: .dark,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          githubIntegrationEnabled: true,
          glowingPaneRingEnabled: false,
          restoreTerminalLayoutEnabled: false,
          systemNotificationsEnabled: true,
          updateChannel: .tip
        )
      }

      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.claudeSettingsClient.hasSupatermHooks = { false }
        $0.codexSettingsClient.hasSupatermHooks = { false }
        $0.githubCLIClient.authStatus = { GithubAuthStatus(username: "khoi", host: "github.com") }
        $0.githubCLIClient.isAvailable = { true }
        $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
        $0.piSettingsClient.hasSupatermIntegration = { false }
      }

      await store.send(.task)
      await store.receive(.settingsLoaded(supatermSettings), timeout: 0) {
        $0.appearanceMode = .dark
        $0.analyticsEnabled = false
        $0.crashReportsEnabled = true
        $0.githubIntegrationEnabled = true
        $0.glowingPaneRingEnabled = false
        $0.restoreTerminalLayoutEnabled = false
        $0.systemNotificationsEnabled = true
        $0.updateChannel = .tip
      }
      await store.receive(.terminalSettingsLoadRequested, timeout: 0) {
        $0.terminal.isLoading = true
      }
      await store.receive(.agentIntegrationStatusRefreshRequested(.claude), timeout: 0) {
        $0.claudeIntegration.isPending = true
      }
      await store.receive(.agentIntegrationStatusRefreshRequested(.codex), timeout: 0) {
        $0.codexIntegration.isPending = true
      }
      await store.receive(.agentIntegrationStatusRefreshRequested(.pi), timeout: 0) {
        $0.piIntegration.isPending = true
      }
      await store.receive(.githubIntegrationStatusRefreshRequested, timeout: 0)
      await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
        $0.terminal = terminalSettingsState()
      }
      await store.receive(
        .githubIntegrationStatusRefreshed(
          .authenticated(username: "khoi", host: "github.com")
        ),
        timeout: 0
      ) {
        $0.githubIntegrationStatus = .authenticated(username: "khoi", host: "github.com")
      }
      await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(false)), timeout: 0) {
        $0.claudeIntegration.isPending = false
      }
      await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(false)), timeout: 0) {
        $0.codexIntegration.isPending = false
      }
      await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(false)), timeout: 0) {
        $0.piIntegration.isPending = false
      }
    }
  }

  @Test
  func taskMirrorsSparkleUpdateSettingsIntoState() async {
    let (stream, continuation) = makeSettingsStream()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.hasSupatermHooks = { false }
      $0.codexSettingsClient.hasSupatermHooks = { false }
      $0.githubCLIClient.authStatus = { GithubAuthStatus(username: "khoi", host: "github.com") }
      $0.githubCLIClient.isAvailable = { true }
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      $0.piSettingsClient.hasSupatermIntegration = { false }
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)
    await store.receive(.terminalSettingsLoadRequested, timeout: 0) {
      $0.terminal.isLoading = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.claude), timeout: 0) {
      $0.claudeIntegration.isPending = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.codex), timeout: 0) {
      $0.codexIntegration.isPending = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.pi), timeout: 0) {
      $0.piIntegration.isPending = true
    }
    await store.receive(.githubIntegrationStatusRefreshRequested, timeout: 0)
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
      $0.terminal = terminalSettingsState()
    }
    await store.receive(
      .githubIntegrationStatusRefreshed(
        .authenticated(username: "khoi", host: "github.com")
      ),
      timeout: 0
    ) {
      $0.githubIntegrationStatus = .authenticated(username: "khoi", host: "github.com")
    }
    await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(false)), timeout: 0) {
      $0.claudeIntegration.isPending = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(false)), timeout: 0) {
      $0.codexIntegration.isPending = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(false)), timeout: 0) {
      $0.piIntegration.isPending = false
    }

    continuation.yield(
      .init(
        automaticallyChecksForUpdates: false,
        automaticallyDownloadsUpdates: false,
        canCheckForUpdates: true,
        phase: .idle
      )
    )

    await store.receive(\.updateClientSnapshotReceived) {
      $0.updatesAutomaticallyCheckForUpdates = false
      $0.updatesAutomaticallyDownloadUpdates = false
    }

    continuation.finish()
    await store.finish()
  }

  @Test
  func tabSelectionUpdatesState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }

    await store.send(.tabSelected(.terminal)) {
      $0.selectedTab = .terminal
    }

    await store.send(.tabSelected(.codingAgents)) {
      $0.selectedTab = .codingAgents
    }

    await store.send(.tabSelected(.notifications)) {
      $0.selectedTab = .notifications
    }

    await store.send(.tabSelected(.about)) {
      $0.selectedTab = .about
    }
  }

  @Test
  func appearanceModeSelectionPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.appearanceModeSelected(.dark)) {
        $0.appearanceMode = .dark
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.appearanceMode == .dark)
    }
  }

  @Test
  func diagnosticsSettingsPersistPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.analyticsEnabledChanged(false)) {
        $0.analyticsEnabled = false
      }

      await store.send(.crashReportsEnabledChanged(false)) {
        $0.crashReportsEnabled = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.analyticsEnabled)
      #expect(!supatermSettings.crashReportsEnabled)
    }
  }

  @Test
  func restoreTerminalLayoutSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.restoreTerminalLayoutEnabledChanged(false)) {
        $0.restoreTerminalLayoutEnabled = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.restoreTerminalLayoutEnabled)
    }
  }

  @Test
  func glowingPaneRingSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.glowingPaneRingEnabledChanged(false)) {
        $0.glowingPaneRingEnabled = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.glowingPaneRingEnabled)
    }
  }

  @Test
  func enablingSystemNotificationsPersistsPrefsWhenAuthorized() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.desktopNotificationClient.authorizationStatus = { .authorized }
      }

      await store.send(.systemNotificationsEnabledChanged(true)) {
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.authorized), timeout: 0)

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.systemNotificationsEnabled)
    }
  }

  @Test
  func enablingSystemNotificationsWithDeniedRequestRevertsToggleAndShowsAlert() async throws {
    let recorder = SettingsNotificationPermissionRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.desktopNotificationClient.authorizationStatus = { .notDetermined }
        $0.desktopNotificationClient.requestAuthorization = {
          await recorder.recordRequest()
          return .init(granted: false, errorMessage: "Mock request error")
        }
      }

      await store.send(.systemNotificationsEnabledChanged(true)) {
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.notDetermined), timeout: 0)
      await store.receive(
        .systemNotificationsAuthorizationResult(
          .init(granted: false, errorMessage: "Mock request error")
        )
      ) {
        $0.systemNotificationsEnabled = false
        $0.alert = notificationPermissionAlert(
          "Supaterm cannot send system notifications.\n\nError: Mock request error")
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.systemNotificationsEnabled)
      #expect(await recorder.requestCount() == 1)
    }
  }

  @Test
  func enablingSystemNotificationsWithDeniedStatusRevertsToggleAndShowsAlert() async throws {
    let recorder = SettingsNotificationPermissionRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.desktopNotificationClient.authorizationStatus = { .denied }
        $0.desktopNotificationClient.requestAuthorization = {
          await recorder.recordRequest()
          return .init(granted: true, errorMessage: nil)
        }
      }

      await store.send(.systemNotificationsEnabledChanged(true)) {
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.denied), timeout: 0)
      await store.receive(
        .systemNotificationsAuthorizationResult(
          .init(granted: false, errorMessage: "Authorization status is denied.")
        )
      ) {
        $0.systemNotificationsEnabled = false
        $0.alert = notificationPermissionAlert(
          "Supaterm cannot send system notifications.\n\nError: Authorization status is denied."
        )
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.systemNotificationsEnabled)
      #expect(await recorder.requestCount() == 0)
    }
  }

  @Test
  func notificationPermissionAlertOpensSystemSettings() async {
    let recorder = SettingsNotificationPermissionRecorder()
    var state = SettingsFeature.State()
    state.alert = notificationPermissionAlert("Supaterm cannot send system notifications.\n\nError: Mock request error")

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.desktopNotificationClient.openSettings = {
        await recorder.recordOpen()
      }
    }

    await store.send(.alert(.presented(.openSystemNotificationSettings))) {
      $0.alert = nil
    }

    #expect(await recorder.openCount() == 1)
  }

  @Test
  func settingsChangeCapturesAnalyticsWhenEnabled() async throws {
    let recorder = AnalyticsEventRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.analyticsClient.capture = { event in
        recorder.record(event)
      }
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.crashReportsEnabledChanged(false)) {
        $0.crashReportsEnabled = false
      }

      #expect(recorder.recorded() == ["settings_changed"])
    }
  }

  @Test
  func disablingAnalyticsDoesNotCaptureSettingsChanged() async throws {
    let recorder = AnalyticsEventRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.analyticsClient.capture = { event in
        recorder.record(event)
      }
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.analyticsEnabledChanged(false)) {
        $0.analyticsEnabled = false
      }

      #expect(recorder.recorded().isEmpty)
    }
  }

  @Test
  func updateChannelPersistsPrefsAndRoutesToUpdateClient() async throws {
    let recorder = UpdateClientCommandRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.updateClient.setUpdateChannel = { updateChannel in
        await recorder.record(.setUpdateChannel(updateChannel))
      }
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.updateChannelSelected(.tip)) {
        $0.updateChannel = .tip
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.updateChannel == .tip)
      #expect(await recorder.recorded() == [.setUpdateChannel(.tip)])
    }
  }

  @Test
  func disablingAutomaticChecksClearsAutomaticDownloadsAndRoutesToUpdateClient() async {
    let recorder = UpdateClientCommandRecorder()
    var state = SettingsFeature.State()
    state.updatesAutomaticallyDownloadUpdates = true

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.updateClient.setAutomaticallyChecksForUpdates = { isEnabled in
        await recorder.record(.setAutomaticallyChecksForUpdates(isEnabled))
      }
    }

    await store.send(.updatesAutomaticallyCheckForUpdatesChanged(false)) {
      $0.updatesAutomaticallyCheckForUpdates = false
      $0.updatesAutomaticallyDownloadUpdates = false
    }

    #expect(await recorder.recorded() == [.setAutomaticallyChecksForUpdates(false)])
  }

  @Test
  func enablingAutomaticDownloadsRoutesToUpdateClient() async {
    let recorder = UpdateClientCommandRecorder()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.updateClient.setAutomaticallyDownloadsUpdates = { isEnabled in
        await recorder.record(.setAutomaticallyDownloadsUpdates(isEnabled))
      }
    }

    await store.send(.updatesAutomaticallyDownloadUpdatesChanged(false)) {
      $0.updatesAutomaticallyDownloadUpdates = false
    }

    #expect(await recorder.recorded() == [.setAutomaticallyDownloadsUpdates(false)])
  }

  @Test
  func checkForUpdatesButtonRoutesThroughUpdateClient() async {
    let recorder = UpdateActionRecorder()
    let analyticsRecorder = AnalyticsEventRecorder()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(.checkForUpdatesButtonTapped)

    #expect(await recorder.actions() == [.checkForUpdates])
    #expect(analyticsRecorder.recorded() == ["update_checked"])
  }

  @Test
  func taskLoadsAgentIntegrationStatuses() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.hasSupatermHooks = { true }
      $0.codexSettingsClient.hasSupatermHooks = { false }
      $0.githubCLIClient.authStatus = { GithubAuthStatus(username: "khoi", host: "github.com") }
      $0.githubCLIClient.isAvailable = { true }
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      $0.piSettingsClient.hasSupatermIntegration = { true }
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)
    await store.receive(.terminalSettingsLoadRequested, timeout: 0) {
      $0.terminal.isLoading = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.claude), timeout: 0) {
      $0.claudeIntegration.isPending = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.codex), timeout: 0) {
      $0.codexIntegration.isPending = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.pi), timeout: 0) {
      $0.piIntegration.isPending = true
    }
    await store.receive(.githubIntegrationStatusRefreshRequested, timeout: 0)
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
      $0.terminal = terminalSettingsState()
    }
    await store.receive(
      .githubIntegrationStatusRefreshed(
        .authenticated(username: "khoi", host: "github.com")
      ),
      timeout: 0
    ) {
      $0.githubIntegrationStatus = .authenticated(username: "khoi", host: "github.com")
    }
    await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(true)), timeout: 0) {
      $0.claudeIntegration.confirmedEnabled = true
      $0.claudeIntegration.isEnabled = true
      $0.claudeIntegration.isPending = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(false)), timeout: 0) {
      $0.codexIntegration.isPending = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(true)), timeout: 0) {
      $0.piIntegration.confirmedEnabled = true
      $0.piIntegration.isEnabled = true
      $0.piIntegration.isPending = false
    }
  }

  @Test
  func githubIntegrationTogglePersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.githubCLIClient.authStatus = { GithubAuthStatus(username: "khoi", host: "github.com") }
        $0.githubCLIClient.isAvailable = { true }
      }

      await store.send(.githubIntegrationEnabledChanged(false)) {
        $0.githubIntegrationEnabled = false
        $0.githubIntegrationStatus = .disabled
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.githubIntegrationEnabled)
    }
  }

  @Test
  func githubIntegrationUnavailableShowsExplicitState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.githubCLIClient.isAvailable = { false }
    }

    await store.send(.githubIntegrationStatusRefreshRequested)
    await store.receive(
      .githubIntegrationStatusRefreshed(
        .unavailable("Install `gh` to enable pull request integration.")
      ),
      timeout: 0
    ) {
      $0.githubIntegrationStatus = .unavailable("Install `gh` to enable pull request integration.")
    }
  }

  @Test
  func githubIntegrationUnauthenticatedShowsExplicitState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.githubCLIClient.authStatus = { nil }
      $0.githubCLIClient.isAvailable = { true }
    }

    await store.send(.githubIntegrationStatusRefreshRequested)
    await store.receive(
      .githubIntegrationStatusRefreshed(
        .unauthenticated("Run `gh auth login` in a terminal to authenticate.")
      ),
      timeout: 0
    ) {
      $0.githubIntegrationStatus = .unauthenticated(
        "Run `gh auth login` in a terminal to authenticate."
      )
    }
  }

  @Test
  func githubIntegrationAuthenticatedShowsAccount() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.githubCLIClient.authStatus = { GithubAuthStatus(username: "khoi", host: "github.example.com") }
      $0.githubCLIClient.isAvailable = { true }
    }

    await store.send(.githubIntegrationStatusRefreshRequested)
    await store.receive(
      .githubIntegrationStatusRefreshed(
        .authenticated(username: "khoi", host: "github.example.com")
      ),
      timeout: 0
    ) {
      $0.githubIntegrationStatus = .authenticated(username: "khoi", host: "github.example.com")
    }
  }

  @Test
  func terminalFontFamilySelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalFontFamilySelected("JetBrains Mono")) {
      $0.terminal.errorMessage = nil
      $0.terminal.fontFamily = "JetBrains Mono"
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(fontFamily: "JetBrains Mono")
      )
    ) {
      $0.terminal = terminalSettingsState(fontFamily: "JetBrains Mono")
    }
  }

  @Test
  func terminalLightThemeSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalLightThemeSelected("Builtin Light")) {
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
      $0.terminal.lightTheme = "Builtin Light"
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(lightTheme: "Builtin Light")
      )
    ) {
      $0.terminal.isApplying = false
      $0.terminal.lightTheme = "Builtin Light"
    }
  }

  @Test
  func terminalDarkThemeSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalDarkThemeSelected("Builtin Dark")) {
      $0.terminal.darkTheme = "Builtin Dark"
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(darkTheme: "Builtin Dark")
      )
    ) {
      $0.terminal.darkTheme = "Builtin Dark"
      $0.terminal.isApplying = false
    }
  }

  @Test
  func terminalSettingsLoadFailureSurfacesError() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.load = {
        throw GhosttyTerminalConfigFileError.invalidConfig("Broken config")
      }
    }

    await store.send(.terminalSettingsLoadRequested) {
      $0.terminal.errorMessage = nil
      $0.terminal.isLoading = true
    }
    await store.receive(.terminalSettingsLoadFailed("Broken config"), timeout: 0) {
      $0.terminal.errorMessage = "Broken config"
      $0.terminal.isLoading = false
    }
  }

  @Test
  func terminalCloseConfirmationSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalConfirmCloseSurfaceSelected(.always)) {
      $0.terminal.confirmCloseSurface = .always
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(confirmCloseSurface: .always)
      )
    ) {
      $0.terminal = terminalSettingsState(confirmCloseSurface: .always)
    }
  }

  @Test
  func claudeIntegrationToggleOnShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {}
      $0.claudeSettingsClient.hasSupatermHooks = { true }
    }

    await store.send(.agentIntegrationToggled(.claude, true)) {
      $0.claudeIntegration.isEnabled = true
      $0.claudeIntegration.isPending = true
    }

    await store.receive(.agentIntegrationToggleFinished(.claude, .success(true)), timeout: 0) {
      $0.claudeIntegration.confirmedEnabled = true
      $0.claudeIntegration.isEnabled = true
      $0.claudeIntegration.isPending = false
    }
  }

  @Test
  func claudeIntegrationToggleFailureRevertsToConfirmedState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {
        throw ClaudeSettingsInstallerError.invalidJSON
      }
    }

    await store.send(.agentIntegrationToggled(.claude, true)) {
      $0.claudeIntegration.isEnabled = true
      $0.claudeIntegration.isPending = true
    }

    await store.receive(
      .agentIntegrationToggleFinished(
        .claude,
        .failure("Claude settings must be valid JSON before Supaterm can install hooks.")
      )
    ) {
      $0.claudeIntegration.errorMessage = "Claude settings must be valid JSON before Supaterm can install hooks."
      $0.claudeIntegration.isEnabled = false
      $0.claudeIntegration.isPending = false
    }
  }

  @Test
  func codexIntegrationToggleOffShowsSuccessState() async {
    var state = SettingsFeature.State()
    state.codexIntegration.confirmedEnabled = true
    state.codexIntegration.isEnabled = true

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.hasSupatermHooks = { false }
      $0.codexSettingsClient.removeSupatermHooks = {}
    }

    await store.send(.agentIntegrationToggled(.codex, false)) {
      $0.codexIntegration.isEnabled = false
      $0.codexIntegration.isPending = true
    }

    await store.receive(.agentIntegrationToggleFinished(.codex, .success(false)), timeout: 0) {
      $0.codexIntegration.confirmedEnabled = false
      $0.codexIntegration.isEnabled = false
      $0.codexIntegration.isPending = false
    }
  }

  @Test
  func codexIntegrationToggleFailureRevertsToConfirmedState() async {
    var state = SettingsFeature.State()
    state.codexIntegration.confirmedEnabled = true
    state.codexIntegration.isEnabled = true

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.removeSupatermHooks = {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    }

    await store.send(.agentIntegrationToggled(.codex, false)) {
      $0.codexIntegration.isEnabled = false
      $0.codexIntegration.isPending = true
    }

    await store.receive(
      .agentIntegrationToggleFinished(
        .codex,
        .failure("Codex must be installed and available in your login shell before Supaterm can install hooks.")
      )
    ) {
      $0.codexIntegration.errorMessage =
        "Codex must be installed and available in your login shell before Supaterm can install hooks."
      $0.codexIntegration.isEnabled = true
      $0.codexIntegration.isPending = false
    }
  }

  @Test
  func piIntegrationUnavailableDisablesTheToggle() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.isPiAvailable = { false }
    }

    await store.send(.agentIntegrationStatusRefreshRequested(.pi)) {
      $0.piIntegration.isPending = true
    }

    await store.receive(
      .agentIntegrationStatusRefreshed(
        .pi,
        .unavailable("Pi must be installed and available in your login shell before Supaterm can manage the package.")
      )
    ) {
      $0.piIntegration.errorMessage =
        "Pi must be installed and available in your login shell before Supaterm can manage the package."
      $0.piIntegration.isAvailable = false
      $0.piIntegration.isPending = false
    }
  }

  @Test
  func piIntegrationToggleOnShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.hasSupatermIntegration = { true }
      $0.piSettingsClient.installSupatermIntegration = {}
    }

    await store.send(.agentIntegrationToggled(.pi, true)) {
      $0.piIntegration.isEnabled = true
      $0.piIntegration.isPending = true
    }

    await store.receive(.agentIntegrationToggleFinished(.pi, .success(true)), timeout: 0) {
      $0.piIntegration.confirmedEnabled = true
      $0.piIntegration.isEnabled = true
      $0.piIntegration.isPending = false
    }
  }
}

private nonisolated func terminalSettingsSnapshot() -> GhosttyTerminalSettingsSnapshot {
  .init(
    availableFontFamilies: ["JetBrains Mono", "SF Mono"],
    availableDarkThemes: ["Zenbones Dark", "Builtin Dark"],
    availableLightThemes: ["Zenbones Light", "Builtin Light"],
    confirmCloseSurface: .whenNotAtPrompt,
    configPath: "/tmp/ghostty/config",
    darkTheme: "Zenbones Dark",
    fontFamily: nil,
    fontSize: 15,
    lightTheme: "Zenbones Light",
    warningMessage: nil
  )
}

private nonisolated func terminalSettingsState(
  confirmCloseSurface: GhosttyTerminalCloseConfirmation = .whenNotAtPrompt,
  darkTheme: String? = "Zenbones Dark",
  errorMessage: String? = nil,
  fontFamily: String? = nil,
  fontSize: Double = 15,
  isApplying: Bool = false,
  isLoading: Bool = false,
  lightTheme: String? = "Zenbones Light",
  warningMessage: String? = nil
) -> SettingsTerminalState {
  SettingsTerminalState(
    availableFontFamilies: ["JetBrains Mono", "SF Mono"],
    availableDarkThemes: ["Zenbones Dark", "Builtin Dark"],
    availableLightThemes: ["Zenbones Light", "Builtin Light"],
    confirmCloseSurface: confirmCloseSurface,
    configPath: "/tmp/ghostty/config",
    darkTheme: darkTheme,
    errorMessage: errorMessage,
    fontFamily: fontFamily,
    fontSize: fontSize,
    isApplying: isApplying,
    isLoading: isLoading,
    lightTheme: lightTheme,
    warningMessage: warningMessage
  )
}

private nonisolated func terminalSettingsValues(
  confirmCloseSurface: GhosttyTerminalCloseConfirmation = .whenNotAtPrompt,
  darkTheme: String? = "Zenbones Dark",
  fontFamily: String? = nil,
  fontSize: Double = 15,
  lightTheme: String? = "Zenbones Light",
  warningMessage: String? = nil
) -> GhosttyTerminalSettingsValues {
  .init(
    confirmCloseSurface: confirmCloseSurface,
    configPath: "/tmp/ghostty/config",
    darkTheme: darkTheme,
    fontFamily: fontFamily,
    fontSize: fontSize,
    lightTheme: lightTheme,
    warningMessage: warningMessage
  )
}

private func terminalSettingsValues(
  from settings: GhosttyTerminalSettingsDraft,
  warningMessage: String? = nil
) -> GhosttyTerminalSettingsValues {
  terminalSettingsValues(
    confirmCloseSurface: settings.confirmCloseSurface,
    darkTheme: settings.darkTheme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lightTheme: settings.lightTheme,
    warningMessage: warningMessage
  )
}

private func notificationPermissionAlert(_ message: String) -> AlertState<SettingsFeature.Alert> {
  AlertState {
    TextState("Enable Notifications in System Settings")
  } actions: {
    ButtonState(action: .openSystemNotificationSettings) {
      TextState("Open System Settings")
    }
    ButtonState(role: .cancel, action: .dismiss) {
      TextState("Cancel")
    }
  } message: {
    TextState(message)
  }
}

private actor SettingsNotificationPermissionRecorder {
  private var openCountValue = 0
  private var requestCountValue = 0

  func openCount() -> Int {
    openCountValue
  }

  func recordOpen() {
    openCountValue += 1
  }

  func recordRequest() {
    requestCountValue += 1
  }

  func requestCount() -> Int {
    requestCountValue
  }
}

private actor UpdateActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}

private enum UpdateClientCommand: Equatable {
  case setAutomaticallyChecksForUpdates(Bool)
  case setAutomaticallyDownloadsUpdates(Bool)
  case setUpdateChannel(UpdateChannel)
}

private actor UpdateClientCommandRecorder {
  private var commands: [UpdateClientCommand] = []

  func recorded() -> [UpdateClientCommand] {
    commands
  }

  func record(_ command: UpdateClientCommand) {
    commands.append(command)
  }
}

private func makeSettingsStream() -> (
  AsyncStream<UpdateClient.Snapshot>,
  AsyncStream<UpdateClient.Snapshot>.Continuation
) {
  var capturedContinuation: AsyncStream<UpdateClient.Snapshot>.Continuation?
  let stream = AsyncStream<UpdateClient.Snapshot> { continuation in
    capturedContinuation = continuation
  }
  return (stream, capturedContinuation!)
}
