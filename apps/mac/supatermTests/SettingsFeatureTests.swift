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
        $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      }

      await store.send(.task)
      await store.receive(.settingsLoaded(supatermSettings)) {
        $0.appearanceMode = .dark
        $0.analyticsEnabled = false
        $0.crashReportsEnabled = true
        $0.restoreTerminalLayoutEnabled = false
        $0.systemNotificationsEnabled = true
        $0.updateChannel = .tip
      }
      await store.receive(.terminalSettingsLoadRequested) {
        $0.terminal.isLoading = true
      }
      await store.receive(.agentHooksStatusRefreshRequested(.claude)) {
        $0.claudeHooks.isPending = true
      }
      await store.receive(.agentHooksStatusRefreshRequested(.codex)) {
        $0.codexHooks.isPending = true
      }
      await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot())) {
        $0.terminal = terminalSettingsState()
      }
      await store.receive(.agentHooksStatusRefreshed(.claude, .success(false))) {
        $0.claudeHooks.isPending = false
      }
      await store.receive(.agentHooksStatusRefreshed(.codex, .success(false))) {
        $0.codexHooks.isPending = false
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
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)
    await store.receive(.terminalSettingsLoadRequested) {
      $0.terminal.isLoading = true
    }
    await store.receive(.agentHooksStatusRefreshRequested(.claude)) {
      $0.claudeHooks.isPending = true
    }
    await store.receive(.agentHooksStatusRefreshRequested(.codex)) {
      $0.codexHooks.isPending = true
    }
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot())) {
      $0.terminal = terminalSettingsState()
    }
    await store.receive(.agentHooksStatusRefreshed(.claude, .success(false))) {
      $0.claudeHooks.isPending = false
    }
    await store.receive(.agentHooksStatusRefreshed(.codex, .success(false))) {
      $0.codexHooks.isPending = false
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
      await store.receive(.systemNotificationsAuthorizationChecked(.authorized))

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
      await store.receive(.systemNotificationsAuthorizationChecked(.notDetermined))
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
      await store.receive(.systemNotificationsAuthorizationChecked(.denied))
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
  func taskLoadsAgentHookStatuses() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.hasSupatermHooks = { true }
      $0.codexSettingsClient.hasSupatermHooks = { false }
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)
    await store.receive(.terminalSettingsLoadRequested) {
      $0.terminal.isLoading = true
    }
    await store.receive(.agentHooksStatusRefreshRequested(.claude)) {
      $0.claudeHooks.isPending = true
    }
    await store.receive(.agentHooksStatusRefreshRequested(.codex)) {
      $0.codexHooks.isPending = true
    }
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot())) {
      $0.terminal = terminalSettingsState()
    }
    await store.receive(.agentHooksStatusRefreshed(.claude, .success(true))) {
      $0.claudeHooks.confirmedEnabled = true
      $0.claudeHooks.isEnabled = true
      $0.claudeHooks.isPending = false
    }
    await store.receive(.agentHooksStatusRefreshed(.codex, .success(false))) {
      $0.codexHooks.isPending = false
    }
  }

  @Test
  func terminalFontFamilySelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { fontFamily, fontSize, lightTheme, darkTheme in
        terminalSettingsValues(
          darkTheme: darkTheme,
          fontFamily: fontFamily,
          fontSize: fontSize,
          lightTheme: lightTheme,
        )
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
      $0.ghosttyTerminalSettingsClient.apply = { fontFamily, fontSize, lightTheme, darkTheme in
        terminalSettingsValues(
          darkTheme: darkTheme,
          fontFamily: fontFamily,
          fontSize: fontSize,
          lightTheme: lightTheme,
        )
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
      $0.ghosttyTerminalSettingsClient.apply = { fontFamily, fontSize, lightTheme, darkTheme in
        terminalSettingsValues(
          darkTheme: darkTheme,
          fontFamily: fontFamily,
          fontSize: fontSize,
          lightTheme: lightTheme,
        )
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
    await store.receive(.terminalSettingsLoadFailed("Broken config")) {
      $0.terminal.errorMessage = "Broken config"
      $0.terminal.isLoading = false
    }
  }

  @Test
  func claudeHooksToggleOnShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {}
      $0.claudeSettingsClient.hasSupatermHooks = { true }
    }

    await store.send(.agentHooksToggled(.claude, true)) {
      $0.claudeHooks.isEnabled = true
      $0.claudeHooks.isPending = true
    }

    await store.receive(.agentHooksToggleFinished(.claude, .success(true))) {
      $0.claudeHooks.confirmedEnabled = true
      $0.claudeHooks.isEnabled = true
      $0.claudeHooks.isPending = false
    }
  }

  @Test
  func claudeHooksToggleFailureRevertsToConfirmedState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {
        throw ClaudeSettingsInstallerError.invalidJSON
      }
    }

    await store.send(.agentHooksToggled(.claude, true)) {
      $0.claudeHooks.isEnabled = true
      $0.claudeHooks.isPending = true
    }

    await store.receive(
      .agentHooksToggleFinished(
        .claude,
        .failure("Claude settings must be valid JSON before Supaterm can install hooks.")
      )
    ) {
      $0.claudeHooks.errorMessage = "Claude settings must be valid JSON before Supaterm can install hooks."
      $0.claudeHooks.isEnabled = false
      $0.claudeHooks.isPending = false
    }
  }

  @Test
  func codexHooksToggleOffShowsSuccessState() async {
    var state = SettingsFeature.State()
    state.codexHooks.confirmedEnabled = true
    state.codexHooks.isEnabled = true

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.hasSupatermHooks = { false }
      $0.codexSettingsClient.removeSupatermHooks = {}
    }

    await store.send(.agentHooksToggled(.codex, false)) {
      $0.codexHooks.isEnabled = false
      $0.codexHooks.isPending = true
    }

    await store.receive(.agentHooksToggleFinished(.codex, .success(false))) {
      $0.codexHooks.confirmedEnabled = false
      $0.codexHooks.isEnabled = false
      $0.codexHooks.isPending = false
    }
  }

  @Test
  func codexHooksToggleFailureRevertsToConfirmedState() async {
    var state = SettingsFeature.State()
    state.codexHooks.confirmedEnabled = true
    state.codexHooks.isEnabled = true

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.removeSupatermHooks = {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    }

    await store.send(.agentHooksToggled(.codex, false)) {
      $0.codexHooks.isEnabled = false
      $0.codexHooks.isPending = true
    }

    await store.receive(
      .agentHooksToggleFinished(
        .codex,
        .failure("Codex must be installed and available in your login shell before Supaterm can install hooks.")
      )
    ) {
      $0.codexHooks.errorMessage =
        "Codex must be installed and available in your login shell before Supaterm can install hooks."
      $0.codexHooks.isEnabled = true
      $0.codexHooks.isPending = false
    }
  }
}

private nonisolated func terminalSettingsSnapshot() -> GhosttyTerminalSettingsSnapshot {
  .init(
    availableFontFamilies: ["JetBrains Mono", "SF Mono"],
    availableDarkThemes: ["Zenbones Dark", "Builtin Dark"],
    availableLightThemes: ["Zenbones Light", "Builtin Light"],
    configPath: "/tmp/ghostty/config",
    darkTheme: "Zenbones Dark",
    fontFamily: nil,
    fontSize: 15,
    lightTheme: "Zenbones Light",
    warningMessage: nil
  )
}

private nonisolated func terminalSettingsState(
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
  darkTheme: String? = "Zenbones Dark",
  fontFamily: String? = nil,
  fontSize: Double = 15,
  lightTheme: String? = "Zenbones Light",
  warningMessage: String? = nil
) -> GhosttyTerminalSettingsValues {
  .init(
    configPath: "/tmp/ghostty/config",
    darkTheme: darkTheme,
    fontFamily: fontFamily,
    fontSize: fontSize,
    lightTheme: lightTheme,
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
