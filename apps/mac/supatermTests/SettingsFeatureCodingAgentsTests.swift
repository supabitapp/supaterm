import ComposableArchitecture
import Sharing
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature
@testable import SupatermSupport

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
        $0.$supatermSettings.withLock {
          $0.codingAgentsShowPanel = false
        }
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.codingAgentsShowPanel)
    }
  }

  @Test
  func taskLoadsAgentIntegrationStatuses() async {
    let terminalGate = SettingsTestGate<GhosttyTerminalSettingsSnapshot>()
    let claudeGate = SettingsTestGate<CodingAgentIntegrationHealth>()
    let codexGate = SettingsTestGate<CodingAgentIntegrationHealth>()
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.integrationHealth = { await claudeGate.next() }
      $0.codexSettingsClient.integrationHealth = { await codexGate.next() }
      $0.ghosttyTerminalSettingsClient.load = { await terminalGate.next() }
      $0.shortcutSettingsClient.terminalReservedDisplays = { [] }
      $0.updateClient.observe = { AsyncStream { $0.finish() } }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    await store.receive(\.terminalSettingsLoadRequested, timeout: Duration.zero) {
      $0.terminal.operation = .loading
    }
    await store.receive(\.agentIntegrationStatusRefreshRequested, .claude, timeout: Duration.zero) {
      $0.claudeIntegration.operation = .refreshing
    }
    await store.receive(\.agentIntegrationStatusRefreshRequested, .codex, timeout: Duration.zero) {
      $0.codexIntegration.operation = .refreshing
    }
    await terminalGate.send(terminalSettingsSnapshot())
    await store.receive(\.terminalSettingsLoadResponse) {
      $0.terminal = terminalSettingsState()
    }
    await claudeGate.send(.healthy)
    await store.receive(\.agentIntegrationStatusRefreshed) {
      $0.claudeIntegration.health = .healthy
      $0.claudeIntegration.operation = .idle
    }
    await codexGate.send(.absent)
    await store.receive(\.agentIntegrationStatusRefreshed) {
      $0.codexIntegration.operation = .idle
    }
  }

  @Test
  func enablingAgentIntegrationInstallsSupatermSkillFirst() async {
    for agent in SupatermAgentKind.managedIntegrationCases {
      let keyPath = SettingsFeature().agentIntegrationKeyPath(for: agent)
      let recorder = SettingsAgentInstallRecorder()
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: { dependencies in
        configureEnableDependencies(&dependencies, agent: agent, recorder: recorder)
      }

      await store.send(.agentIntegrationToggled(agent, true)) {
        $0[keyPath: keyPath].operation = .settingEnabled(true)
      }

      await store.receive(\.agentIntegrationToggleFinished, timeout: Duration.zero) {
        $0[keyPath: keyPath].health = .healthy
        $0[keyPath: keyPath].operation = .idle
      }

      #expect(await recorder.commands() == [.skill, .integration(agent)])
    }
  }

  @Test
  func disablingAgentIntegrationDoesNotInstallSupatermSkill() async {
    for agent in SupatermAgentKind.managedIntegrationCases {
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
        $0[keyPath: keyPath].operation = .settingEnabled(false)
      }

      await store.receive(\.agentIntegrationToggleFinished, timeout: Duration.zero) {
        $0[keyPath: keyPath].health = .absent
        $0[keyPath: keyPath].operation = .idle
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
      $0.supatermSkillClient.installSupatermSkill = {}
    }

    await store.send(.agentIntegrationToggled(.claude, true)) {
      $0.claudeIntegration.operation = .settingEnabled(true)
    }

    await store.receive(\.agentIntegrationToggleFinished, timeout: Duration.zero) {
      $0.claudeIntegration.health = .healthy
      $0.claudeIntegration.operation = .idle
    }
  }

  @Test
  func claudeIntegrationToggleFailureRevertsToConfirmedState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.integrationHealth = { .healthy }
      $0.claudeSettingsClient.installSupatermHooks = {
        throw ClaudeSettingsInstallerError.invalidJSON
      }
      $0.supatermSkillClient.installSupatermSkill = {}
    }

    await store.send(.agentIntegrationToggled(.claude, true)) {
      $0.claudeIntegration.operation = .settingEnabled(true)
    }

    await store.receive(
      \.agentIntegrationToggleFinished
    ) {
      $0.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(
        agent: .claude,
        log: "Claude settings must be valid JSON before Supaterm can install hooks."
      )
      $0.claudeIntegration.errorMessage = "Claude settings must be valid JSON before Supaterm can install hooks."
      $0.claudeIntegration.operation = .idle
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
      $0.codexIntegration.operation = .settingEnabled(false)
    }

    await store.receive(\.agentIntegrationToggleFinished, timeout: Duration.zero) {
      $0.codexIntegration.health = .absent
      $0.codexIntegration.operation = .idle
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
      $0.codexIntegration.operation = .settingEnabled(false)
    }
    await store.receive(\.agentIntegrationToggleFinished, timeout: Duration.zero) {
      $0.codexIntegration.health = .unavailable
      $0.codexIntegration.operation = .idle
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
      $0.codexIntegration.operation = .settingEnabled(false)
    }

    await store.receive(
      \.agentIntegrationToggleFinished
    ) {
      $0.codexIntegration.errorMessage =
        "Codex must be installed and available in your login shell before Supaterm can install hooks."
      $0.codexIntegration.operation = .idle
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
    preconditionFailure("Pi has no managed integration")
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
    preconditionFailure("Pi has no managed integration")
  }
}
