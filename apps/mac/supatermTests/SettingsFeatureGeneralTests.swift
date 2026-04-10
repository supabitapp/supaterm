import ComposableArchitecture
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SettingsFeatureGeneralTests {
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
  func newTabPositionSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.newTabPositionSelected(.current)) {
        $0.newTabPosition = .current
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.newTabPosition == .current)
    }
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
}
