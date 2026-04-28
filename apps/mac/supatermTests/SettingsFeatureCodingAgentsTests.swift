import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureCodingAgentsTests {
  @Test
  func showIconsSettingPersistsPrefs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.codingAgentsShowIconsChanged(false)) {
        $0.codingAgentsShowIcons = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.codingAgentsShowIcons)
    }
  }

  @Test
  func taskLoadsAgentIntegrationStatuses() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.hasSupatermHooks = { true }
      $0.codexSettingsClient.hasSupatermHooks = { false }
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
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
      $0.terminal = terminalSettingsState()
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
      $0.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(
        agent: .claude,
        log: "Claude settings must be valid JSON before Supaterm can install hooks."
      )
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

  @Test
  func piIntegrationInstallFailureShowsErrorLogAlert() async {
    let log = "clone failed\nfatal: repository not found"
    let message = "Supaterm could not install the Pi package: \(log)"
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.installSupatermIntegration = {
        throw PiSettingsInstallerError.installFailed(log)
      }
    }

    await store.send(.agentIntegrationToggled(.pi, true)) {
      $0.piIntegration.isEnabled = true
      $0.piIntegration.isPending = true
    }

    await store.receive(.agentIntegrationToggleFinished(.pi, .failure(message)), timeout: 0) {
      $0.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(agent: .pi, log: message)
      $0.piIntegration.errorMessage = message
      $0.piIntegration.isEnabled = false
      $0.piIntegration.isPending = false
    }

    await store.send(.agentIntegrationInstallFailureDismissed) {
      $0.agentIntegrationInstallFailure = nil
    }
  }
}
