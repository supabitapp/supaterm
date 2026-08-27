import ComposableArchitecture
import Foundation
import Sharing
import SupatermSupport
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import SupatermLicenseFeature
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureTests {
  @Test
  func initialStateStartsOnGeneralTab() {
    let state = SettingsFeature.State()

    #expect(state.selectedTab == .general)
  }

  @Test
  func freeLicenseStatusExplainsTheActiveLimit() {
    let state = LicenseFeature.State(runtime: .preview())

    #expect(state.settingsStatus == "Use Supaterm free with up to five tabs, or activate a license.")
  }

  @Test
  func tabOrderEndsWithAbout() {
    #expect(
      SettingsFeature.Tab.allCases
        == [.general, .license, .terminal, .notifications, .shortcuts, .codingAgents, .advanced, .about]
    )
  }

  @Test
  func taskLoadsPersistedSettings() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      defer { SupatermLog.setVerboseLoggingEnabled(false) }
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0 = SupatermSettings(
          appearanceMode: .dark,
          analyticsEnabled: false,
          codingAgentsShowPanel: false,
          crashReportsEnabled: true,
          glowingPaneRingEnabled: false,
          restoreTerminalLayoutEnabled: false,
          systemNotificationsEnabled: true,
          updateChannel: .tip,
          verboseLoggingEnabled: true,
          zmxSessionsEnabled: false
        )
      }
      let terminalGate = SettingsTestGate<GhosttyTerminalSettingsSnapshot>()
      let claudeGate = SettingsTestGate<CodingAgentIntegrationHealth>()
      let codexGate = SettingsTestGate<CodingAgentIntegrationHealth>()
      let piGate = SettingsTestGate<CodingAgentIntegrationHealth>()

      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.claudeSettingsClient.integrationHealth = { await claudeGate.next() }
        $0.codexSettingsClient.integrationHealth = { await codexGate.next() }
        $0.ghosttyTerminalSettingsClient.load = { await terminalGate.next() }
        $0.piSettingsClient.integrationHealth = { await piGate.next() }
        $0.shortcutSettingsClient.terminalReservedDisplays = { [] }
        $0.updateClient.observe = { AsyncStream { $0.finish() } }
        $0.updateClient.start = {}
      }

      #expect(store.state.appearanceMode == .dark)
      #expect(!store.state.analyticsEnabled)
      #expect(!store.state.codingAgentsShowPanel)
      #expect(store.state.crashReportsEnabled)
      #expect(!store.state.glowingPaneRingEnabled)
      #expect(store.state.updateChannel == .tip)
      #expect(!store.state.restoreTerminalLayoutEnabled)
      #expect(store.state.systemNotificationsEnabled)
      #expect(store.state.verboseLoggingEnabled)
      #expect(!store.state.zmxSessionsEnabled)

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
      await store.receive(\.agentIntegrationStatusRefreshRequested, .pi, timeout: Duration.zero) {
        $0.piIntegration.operation = .refreshing
      }
      await terminalGate.send(terminalSettingsSnapshot())
      await store.receive(\.terminalSettingsLoadResponse) {
        $0.terminal = terminalSettingsState()
      }
      await claudeGate.send(.absent)
      await store.receive(\.agentIntegrationStatusRefreshed) {
        $0.claudeIntegration.operation = .idle
      }
      await codexGate.send(.absent)
      await store.receive(\.agentIntegrationStatusRefreshed) {
        $0.codexIntegration.operation = .idle
      }
      await piGate.send(.absent)
      await store.receive(\.agentIntegrationStatusRefreshed) {
        $0.piIntegration.operation = .idle
      }
    }
  }

  @Test
  func taskMirrorsSparkleUpdateSettingsIntoState() async {
    let (stream, continuation) = makeSettingsStream()
    let terminalGate = SettingsTestGate<GhosttyTerminalSettingsSnapshot>()
    let claudeGate = SettingsTestGate<CodingAgentIntegrationHealth>()
    let codexGate = SettingsTestGate<CodingAgentIntegrationHealth>()
    let piGate = SettingsTestGate<CodingAgentIntegrationHealth>()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.integrationHealth = { await claudeGate.next() }
      $0.codexSettingsClient.integrationHealth = { await codexGate.next() }
      $0.ghosttyTerminalSettingsClient.load = { await terminalGate.next() }
      $0.piSettingsClient.integrationHealth = { await piGate.next() }
      $0.shortcutSettingsClient.terminalReservedDisplays = { [] }
      $0.updateClient.observe = { stream }
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
    await store.receive(\.agentIntegrationStatusRefreshRequested, .pi, timeout: Duration.zero) {
      $0.piIntegration.operation = .refreshing
    }
    await terminalGate.send(terminalSettingsSnapshot())
    await store.receive(\.terminalSettingsLoadResponse) {
      $0.terminal = terminalSettingsState()
    }
    await claudeGate.send(.absent)
    await store.receive(\.agentIntegrationStatusRefreshed) {
      $0.claudeIntegration.operation = .idle
    }
    await codexGate.send(.absent)
    await store.receive(\.agentIntegrationStatusRefreshed) {
      $0.codexIntegration.operation = .idle
    }
    await piGate.send(.absent)
    await store.receive(\.agentIntegrationStatusRefreshed) {
      $0.piIntegration.operation = .idle
    }

    continuation.yield(
      UpdateClient.Snapshot(
        automaticallyChecksForUpdates: false,
        automaticallyDownloadsUpdates: false,
        canCheckForUpdates: true,
        phase: .idle
      )
    )

    await store.receive(\.updateClientSnapshotReceived) {
      $0.about.updatesAutomaticallyCheckForUpdates = false
      $0.about.updatesAutomaticallyDownloadUpdates = false
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

    await store.send(.tabSelected(.advanced)) {
      $0.selectedTab = .advanced
    }

    await store.send(.tabSelected(.notifications)) {
      $0.selectedTab = .notifications
    }

    await store.send(.tabSelected(.about)) {
      $0.selectedTab = .about
    }
  }
}
