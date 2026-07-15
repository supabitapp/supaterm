import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureCodingAgentsTests {
  @Test
  func integrationHealthDrivesToggleAndStatusMessage() {
    var state = SettingsAgentIntegrationState(health: .healthy)
    #expect(state.isAvailable)
    #expect(state.isEnabled)
    #expect(state.message(for: .codex) == nil)

    state.health = .partial
    #expect(state.isEnabled)
    #expect(state.message(for: .codex) == "Codex integration is incomplete.")

    state.health = .drifted
    #expect(state.isEnabled)
    #expect(state.message(for: .codex) == "Codex integration needs repair.")

    state.health = .unavailableInstalled
    #expect(state.isAvailable)
    #expect(state.isEnabled)
    #expect(state.message(for: .codex) == "Codex 0.144.1 or newer is unavailable.")

    state.health = .unavailable
    #expect(!state.isAvailable)
    #expect(state.message(for: .codex) == "Codex 0.144.1 or newer is unavailable.")
  }

  @Test
  func showPanelSettingPersistsPrefs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.codingAgentsShowPanelChanged(false)) {
        $0.codingAgentsShowPanel = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.codingAgentsShowPanel)
    }
  }

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
  func showSpinnerSettingPersistsPrefs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.codingAgentsShowSpinnerChanged(false)) {
        $0.codingAgentsShowSpinner = false
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.codingAgentsShowSpinner)
    }
  }

  @Test
  func taskLoadsAgentIntegrationStatuses() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.integrationHealth = { .healthy }
      $0.codexSettingsClient.integrationHealth = { .absent }
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      $0.piSettingsClient.integrationHealth = { .healthy }
    }

    await store.send(.task)
    await store.receive(\.settingsLoaded)
    await store.receive(.terminalSettingsLoadRequested, timeout: Duration.zero) {
      $0.terminal.isLoading = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.claude), timeout: Duration.zero) {
      $0.claudeIntegration.isRefreshing = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.codex), timeout: Duration.zero) {
      $0.codexIntegration.isRefreshing = true
    }
    await store.receive(.agentIntegrationStatusRefreshRequested(.pi), timeout: Duration.zero) {
      $0.piIntegration.isRefreshing = true
    }
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: Duration.zero) {
      $0.terminal = terminalSettingsState()
    }
    await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(.healthy)), timeout: Duration.zero) {
      $0.claudeIntegration.health = .healthy
      $0.claudeIntegration.isRefreshing = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(.absent)), timeout: Duration.zero) {
      $0.codexIntegration.isRefreshing = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(.healthy)), timeout: Duration.zero) {
      $0.piIntegration.health = .healthy
      $0.piIntegration.isRefreshing = false
    }
  }

  @Test
  func enablingAgentIntegrationInstallsSupatermSkillFirst() async {
    for agent in SupatermAgentKind.allCases {
      let keyPath = SettingsFeature().agentIntegrationKeyPath(for: agent)
      let recorder = SettingsAgentInstallRecorder()
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: { dependencies in
        configureEnableDependencies(&dependencies, agent: agent, recorder: recorder)
      }

      await store.send(.agentIntegrationToggled(agent, true)) {
        $0[keyPath: keyPath].pendingEnabled = true
      }

      await store.receive(.agentIntegrationToggleFinished(agent, .success(.healthy)), timeout: Duration.zero) {
        $0[keyPath: keyPath].health = .healthy
        $0[keyPath: keyPath].pendingEnabled = nil
      }

      #expect(await recorder.commands() == [.skill, .integration(agent)])
    }
  }

  @Test
  func disablingAgentIntegrationDoesNotInstallSupatermSkill() async {
    for agent in SupatermAgentKind.allCases {
      let recorder = SettingsAgentInstallRecorder()
      var state = SettingsFeature.State()
      let keyPath = SettingsFeature().agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].health = .healthy

      let store = TestStore(initialState: state) {
        SettingsFeature()
      } withDependencies: { dependencies in
        configureDisableDependencies(&dependencies, agent: agent, recorder: recorder)
      }

      await store.send(.agentIntegrationToggled(agent, false)) {
        $0[keyPath: keyPath].pendingEnabled = false
      }

      await store.receive(.agentIntegrationToggleFinished(agent, .success(.absent)), timeout: Duration.zero) {
        $0[keyPath: keyPath].health = .absent
        $0[keyPath: keyPath].pendingEnabled = nil
      }

      #expect(await recorder.commands() == [.integration(agent)])
    }
  }

  @Test
  func claudeIntegrationToggleOnShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.installSupatermHooks = {}
      $0.claudeSettingsClient.integrationHealth = { .healthy }
    }

    await store.send(.agentIntegrationToggled(.claude, true)) {
      $0.claudeIntegration.pendingEnabled = true
    }

    await store.receive(.agentIntegrationToggleFinished(.claude, .success(.healthy)), timeout: Duration.zero) {
      $0.claudeIntegration.health = .healthy
      $0.claudeIntegration.pendingEnabled = nil
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
      $0.claudeIntegration.pendingEnabled = true
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
      $0.claudeIntegration.pendingEnabled = nil
    }
  }

  @Test
  func codexIntegrationToggleOffShowsSuccessState() async {
    var state = SettingsFeature.State()
    state.codexIntegration.health = .healthy

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.integrationHealth = { .absent }
      $0.codexSettingsClient.removeSupatermHooks = {}
    }

    await store.send(.agentIntegrationToggled(.codex, false)) {
      $0.codexIntegration.pendingEnabled = false
    }

    await store.receive(.agentIntegrationToggleFinished(.codex, .success(.absent)), timeout: Duration.zero) {
      $0.codexIntegration.health = .absent
      $0.codexIntegration.pendingEnabled = nil
    }
  }

  @Test
  func codexRemovalRunsWhenCodexBecomesUnavailable() async {
    var state = SettingsFeature.State()
    state.codexIntegration.health = .healthy
    let recorder = SettingsAgentInstallRecorder()
    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.integrationHealth = { .unavailable }
      $0.codexSettingsClient.removeSupatermHooks = {
        await recorder.record(.integration(.codex))
      }
    }

    await store.send(.agentIntegrationToggled(.codex, false)) {
      $0.codexIntegration.pendingEnabled = false
    }
    await store.receive(.agentIntegrationToggleFinished(.codex, .success(.unavailable)), timeout: Duration.zero) {
      $0.codexIntegration.health = .unavailable
      $0.codexIntegration.pendingEnabled = nil
    }

    #expect(await recorder.commands() == [.integration(.codex)])
  }

  @Test
  func codexIntegrationToggleFailureRevertsToConfirmedState() async {
    var state = SettingsFeature.State()
    state.codexIntegration.health = .healthy

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.codexSettingsClient.removeSupatermHooks = {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    }

    await store.send(.agentIntegrationToggled(.codex, false)) {
      $0.codexIntegration.pendingEnabled = false
    }

    await store.receive(
      .agentIntegrationToggleFinished(
        .codex,
        .failure("Codex must be installed and available in your login shell before Supaterm can install hooks.")
      )
    ) {
      $0.codexIntegration.errorMessage =
        "Codex must be installed and available in your login shell before Supaterm can install hooks."
      $0.codexIntegration.pendingEnabled = nil
    }
  }

  @Test
  func piIntegrationUnavailableDisablesTheToggle() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.integrationHealth = { .unavailable }
    }

    await store.send(.agentIntegrationStatusRefreshRequested(.pi)) {
      $0.piIntegration.isRefreshing = true
    }

    await store.receive(
      .agentIntegrationStatusRefreshed(
        .pi,
        .success(.unavailable)
      )
    ) {
      $0.piIntegration.health = .unavailable
      $0.piIntegration.isRefreshing = false
    }
  }

  @Test
  func piUnavailableInstalledIntegrationCanBeRemoved() async {
    var state = SettingsFeature.State()
    state.piIntegration.health = .unavailableInstalled
    let recorder = SettingsAgentInstallRecorder()
    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.integrationHealth = { .unavailable }
      $0.piSettingsClient.removeSupatermIntegration = {
        await recorder.record(.integration(.pi))
      }
    }

    await store.send(.agentIntegrationToggled(.pi, false)) {
      $0.piIntegration.pendingEnabled = false
    }
    await store.receive(.agentIntegrationToggleFinished(.pi, .success(.unavailable)), timeout: Duration.zero) {
      $0.piIntegration.health = .unavailable
      $0.piIntegration.pendingEnabled = nil
    }

    #expect(await recorder.commands() == [.integration(.pi)])
  }

  @Test
  func piIntegrationToggleOnShowsSuccessState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.piSettingsClient.integrationHealth = { .healthy }
      $0.piSettingsClient.installSupatermIntegration = {}
    }

    await store.send(.agentIntegrationToggled(.pi, true)) {
      $0.piIntegration.pendingEnabled = true
    }

    await store.receive(.agentIntegrationToggleFinished(.pi, .success(.healthy)), timeout: Duration.zero) {
      $0.piIntegration.health = .healthy
      $0.piIntegration.pendingEnabled = nil
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
      $0.piIntegration.pendingEnabled = true
    }

    await store.receive(.agentIntegrationToggleFinished(.pi, .failure(message)), timeout: Duration.zero) {
      $0.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(agent: .pi, log: message)
      $0.piIntegration.errorMessage = message
      $0.piIntegration.pendingEnabled = nil
    }

    await store.send(.agentIntegrationInstallFailureDismissed) {
      $0.agentIntegrationInstallFailure = nil
    }
  }
}

enum SettingsAgentInstallCommand: Equatable {
  case integration(SupatermAgentKind)
  case skill
}

actor SettingsAgentInstallRecorder {
  private var recordedCommands: [SettingsAgentInstallCommand] = []

  func commands() -> [SettingsAgentInstallCommand] {
    recordedCommands
  }

  func record(_ command: SettingsAgentInstallCommand) {
    recordedCommands.append(command)
  }
}

func configureEnableDependencies(
  _ dependencies: inout DependencyValues,
  agent: SupatermAgentKind,
  recorder: SettingsAgentInstallRecorder
) {
  dependencies.supatermSkillClient.installSupatermSkill = {
    await recorder.record(.skill)
  }
  switch agent {
  case .claude:
    dependencies.claudeSettingsClient.integrationHealth = { .healthy }
    dependencies.claudeSettingsClient.installSupatermHooks = {
      await recorder.record(.integration(agent))
    }
  case .codex:
    dependencies.codexSettingsClient.integrationHealth = { .healthy }
    dependencies.codexSettingsClient.installSupatermHooks = {
      await recorder.record(.integration(agent))
    }
  case .pi:
    dependencies.piSettingsClient.integrationHealth = { .healthy }
    dependencies.piSettingsClient.installSupatermIntegration = {
      await recorder.record(.integration(agent))
    }
  }
}

func configureDisableDependencies(
  _ dependencies: inout DependencyValues,
  agent: SupatermAgentKind,
  recorder: SettingsAgentInstallRecorder
) {
  dependencies.supatermSkillClient.installSupatermSkill = {
    await recorder.record(.skill)
  }
  switch agent {
  case .claude:
    dependencies.claudeSettingsClient.integrationHealth = { .absent }
    dependencies.claudeSettingsClient.removeSupatermHooks = {
      await recorder.record(.integration(agent))
    }
  case .codex:
    dependencies.codexSettingsClient.integrationHealth = { .absent }
    dependencies.codexSettingsClient.removeSupatermHooks = {
      await recorder.record(.integration(agent))
    }
  case .pi:
    dependencies.piSettingsClient.integrationHealth = { .absent }
    dependencies.piSettingsClient.removeSupatermIntegration = {
      await recorder.record(.integration(agent))
    }
  }
}
