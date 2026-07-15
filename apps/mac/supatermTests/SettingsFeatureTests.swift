import ComposableArchitecture
import Foundation
import Sharing
import SupatermSupport
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

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
        == [.general, .terminal, .notifications, .codingAgents, .advanced, .about]
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
          codingAgentsShowIcons: false,
          codingAgentsShowSpinner: false,
          crashReportsEnabled: true,
          glowingPaneRingEnabled: false,
          restoreTerminalLayoutEnabled: false,
          systemNotificationsEnabled: true,
          updateChannel: .tip,
          verboseLoggingEnabled: true,
          zmxSessionsEnabled: false
        )
      }

      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.claudeSettingsClient.integrationHealth = { .absent }
        $0.codexSettingsClient.integrationHealth = { .absent }
        $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
        $0.piSettingsClient.integrationHealth = { .absent }
      }

      await store.send(.task)
      await store.receive(.settingsLoaded(supatermSettings), timeout: Duration.zero) {
        $0.appearanceMode = .dark
        $0.analyticsEnabled = false
        $0.codingAgentsShowPanel = false
        $0.codingAgentsShowIcons = false
        $0.codingAgentsShowSpinner = false
        $0.crashReportsEnabled = true
        $0.glowingPaneRingEnabled = false
        $0.about.updateChannel = .tip
        $0.restoreTerminalLayoutEnabled = false
        $0.systemNotificationsEnabled = true
        $0.verboseLoggingEnabled = true
        $0.zmxSessionsEnabled = false
      }
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
      await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(.absent)), timeout: Duration.zero) {
        $0.claudeIntegration.isRefreshing = false
      }
      await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(.absent)), timeout: Duration.zero) {
        $0.codexIntegration.isRefreshing = false
      }
      await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(.absent)), timeout: Duration.zero) {
        $0.piIntegration.isRefreshing = false
      }
    }
  }

  @Test
  func taskMirrorsSparkleUpdateSettingsIntoState() async {
    let (stream, continuation) = makeSettingsStream()

    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.claudeSettingsClient.integrationHealth = { .absent }
      $0.codexSettingsClient.integrationHealth = { .absent }
      $0.ghosttyTerminalSettingsClient.load = { terminalSettingsSnapshot() }
      $0.piSettingsClient.integrationHealth = { .absent }
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
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
    await store.receive(.agentIntegrationStatusRefreshed(.claude, .success(.absent)), timeout: Duration.zero) {
      $0.claudeIntegration.isRefreshing = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.codex, .success(.absent)), timeout: Duration.zero) {
      $0.codexIntegration.isRefreshing = false
    }
    await store.receive(.agentIntegrationStatusRefreshed(.pi, .success(.absent)), timeout: Duration.zero) {
      $0.piIntegration.isRefreshing = false
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
