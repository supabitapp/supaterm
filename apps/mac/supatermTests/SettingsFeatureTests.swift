import ComposableArchitecture
import Sharing
import Testing

@testable import supaterm

@MainActor
struct SettingsFeatureTests {
  @Test
  func initialStateStartsOnGeneralTab() {
    let state = SettingsFeature.State()

    #expect(state.selectedTab == .general)
  }

  @Test
  func taskLoadsPersistedSettings() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.appPrefs) var appPrefs = .default
      $appPrefs.withLock {
        $0 = AppPrefs(
          appearanceMode: .dark,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          updateChannel: .tip,
          updatesAutomaticallyCheckForUpdates: false,
          updatesAutomaticallyDownloadUpdates: false
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
        $0.updateChannel = .tip
        $0.updatesAutomaticallyCheckForUpdates = false
        $0.updatesAutomaticallyDownloadUpdates = false
      }
    }
  }

  @Test
  func tabSelectionUpdatesState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }

    await store.send(.tabSelected(.codingAgents)) {
      $0.selectedTab = .codingAgents
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
    try await withDependencies {
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
    try await withDependencies {
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
  func settingsChangeCapturesAnalyticsWhenEnabled() async throws {
    let recorder = AnalyticsEventRecorder()

    try await withDependencies {
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

    try await withDependencies {
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
  func updateSettingsPersistAndApplyToUpdater() async throws {
    let recorder = UpdateSettingsRecorder()

    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.updateClient.applySettings = { settings in
        await recorder.record(settings)
      }
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.updateChannelSelected(.tip)) {
        $0.updateChannel = .tip
      }
      await store.send(.updatesAutomaticallyDownloadUpdatesChanged(true)) {
        $0.updatesAutomaticallyDownloadUpdates = true
      }

      @Shared(.appPrefs) var appPrefs = .default
      #expect(appPrefs.updateChannel == .tip)
      #expect(appPrefs.updatesAutomaticallyCheckForUpdates)
      #expect(appPrefs.updatesAutomaticallyDownloadUpdates)
      #expect(
        await recorder.recorded() == [
          UpdateSettings(
            updateChannel: .tip,
            automaticallyChecksForUpdates: true,
            automaticallyDownloadsUpdates: false
          ),
          UpdateSettings(
            updateChannel: .tip,
            automaticallyChecksForUpdates: true,
            automaticallyDownloadsUpdates: true,
          ),
        ]
      )
    }
  }

  @Test
  func disablingAutomaticChecksClearsAutomaticDownloads() async throws {
    let recorder = UpdateSettingsRecorder()

    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      $0.updateClient.applySettings = { settings in
        await recorder.record(settings)
      }
    } operation: {
      var state = SettingsFeature.State()
      state.updatesAutomaticallyDownloadUpdates = true

      let store = TestStore(initialState: state) {
        SettingsFeature()
      }

      await store.send(.updatesAutomaticallyCheckForUpdatesChanged(false)) {
        $0.updatesAutomaticallyCheckForUpdates = false
        $0.updatesAutomaticallyDownloadUpdates = false
      }

      @Shared(.appPrefs) var appPrefs = .default
      #expect(!appPrefs.updatesAutomaticallyCheckForUpdates)
      #expect(!appPrefs.updatesAutomaticallyDownloadUpdates)
      let recorded = await recorder.recorded()
      #expect(recorded.count == 1)
      #expect(
        recorded.first
          == UpdateSettings(
            updateChannel: .stable,
            automaticallyChecksForUpdates: false,
            automaticallyDownloadsUpdates: false
          )
      )
    }
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

private actor UpdateActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}

private actor UpdateSettingsRecorder {
  private var settings: [UpdateSettings] = []

  func recorded() -> [UpdateSettings] {
    settings
  }

  func record(_ setting: UpdateSettings) {
    settings.append(setting)
  }
}
