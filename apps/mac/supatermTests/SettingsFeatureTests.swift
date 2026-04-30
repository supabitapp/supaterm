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
          codingAgentsShowIcons: false,
          codingAgentsShowSpinner: false,
          crashReportsEnabled: true,
          glowingPaneRingEnabled: false,
          newTabPosition: .current,
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
        $0.piSettingsClient.hasSupatermIntegration = { false }
      }

      await store.send(.task)
      await store.receive(.settingsLoaded(supatermSettings), timeout: 0) {
        $0.appearanceMode = .dark
        $0.analyticsEnabled = false
        $0.codingAgentsShowIcons = false
        $0.codingAgentsShowSpinner = false
        $0.crashReportsEnabled = true
        $0.glowingPaneRingEnabled = false
        $0.about.updateChannel = .tip
        $0.newTabPosition = .current
        $0.restoreTerminalLayoutEnabled = false
        $0.systemNotificationsEnabled = true
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
      await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
        $0.terminal = terminalSettingsState()
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
    await store.receive(.terminalSettingsLoaded(terminalSettingsSnapshot()), timeout: 0) {
      $0.terminal = terminalSettingsState()
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

    await store.send(.tabSelected(.notifications)) {
      $0.selectedTab = .notifications
    }

    await store.send(.tabSelected(.about)) {
      $0.selectedTab = .about
    }
  }
}
