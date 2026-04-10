import ComposableArchitecture
import Sharing
import SupatermSupport
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureAboutTests {
  @Test
  func updateChannelPersistsPrefsAndRoutesToUpdateClient() async throws {
    let recorder = SettingsUpdateClientCommandRecorder()

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
    let recorder = SettingsUpdateClientCommandRecorder()
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
    let recorder = SettingsUpdateClientCommandRecorder()

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
    let recorder = SettingsUpdateActionRecorder()
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
}
