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
  func tabOrderIncludesAdvancedAfterGeneral() {
    #expect(
      SettingsFeature.Tab.allCases
        == [.general, .advanced, .notifications, .codingAgents, .updates, .about]
    )
  }

  @Test
  func taskLoadsPersistedSettings() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.appPrefs) var appPrefs = .default
      $appPrefs.withLock {
        $0 = AppPrefs(
          appearanceMode: .dark,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          systemNotificationsEnabled: true,
          updateChannel: .tip
        )
      }

      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.task)
      await store.receive(.settingsLoaded(appPrefs)) {
        $0.appearanceMode = .dark
        $0.analyticsEnabled = false
        $0.crashReportsEnabled = true
        $0.systemNotificationsEnabled = true
        $0.updateChannel = .tip
      }
    }
  }

  @Test
  func taskMirrorsSparkleUpdateSettingsIntoState() async {
    let (stream, continuation) = makeSettingsStream()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)

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

    await store.send(.tabSelected(.advanced)) {
      $0.selectedTab = .advanced
    }

    await store.send(.tabSelected(.codingAgents)) {
      $0.selectedTab = .codingAgents
    }

    await store.send(.tabSelected(.notifications)) {
      $0.selectedTab = .notifications
    }

    await store.send(.tabSelected(.updates)) {
      $0.selectedTab = .updates
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(appPrefs.appearanceMode == .dark)
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(!appPrefs.analyticsEnabled)
      #expect(!appPrefs.crashReportsEnabled)
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(appPrefs.systemNotificationsEnabled)
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(!appPrefs.systemNotificationsEnabled)
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(!appPrefs.systemNotificationsEnabled)
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

      @Shared(.appPrefs) var appPrefs = .default
      #expect(appPrefs.updateChannel == .tip)
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
  func claudeHooksInstallButtonShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {}
    }

    await store.send(.claudeHooksInstallButtonTapped) {
      $0.claudeHooksInstallState = .installing
    }

    await store.receive(.claudeHooksInstallFinished(.success)) {
      $0.claudeHooksInstallState = .succeeded("Claude hooks installed in ~/.claude/settings.json.")
    }
  }

  @Test
  func claudeHooksInstallButtonShowsFailureState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {
        throw ClaudeSettingsInstallerError.invalidJSON
      }
    }

    await store.send(.claudeHooksInstallButtonTapped) {
      $0.claudeHooksInstallState = .installing
    }

    await store.receive(
      .claudeHooksInstallFinished(.failure("Claude settings must be valid JSON before Supaterm can install hooks."))
    ) {
      $0.claudeHooksInstallState = .failed("Claude settings must be valid JSON before Supaterm can install hooks.")
    }
  }

  @Test
  func codexHooksInstallButtonShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.installSupatermHooks = {}
    }

    await store.send(.codexHooksInstallButtonTapped) {
      $0.codexHooksInstallState = .installing
    }

    await store.receive(.codexHooksInstallFinished(.success)) {
      $0.codexHooksInstallState = .succeeded("Codex hooks installed in ~/.codex/hooks.json.")
    }
  }

  @Test
  func codexHooksInstallButtonShowsFailureState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.installSupatermHooks = {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    }

    await store.send(.codexHooksInstallButtonTapped) {
      $0.codexHooksInstallState = .installing
    }

    await store.receive(
      .codexHooksInstallFinished(
        .failure("Codex must be installed and available in your login shell before Supaterm can install hooks.")
      )
    ) {
      $0.codexHooksInstallState = .failed(
        "Codex must be installed and available in your login shell before Supaterm can install hooks."
      )
    }
  }
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
