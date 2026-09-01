import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureNotificationsTests {
  @Test
  func notificationSoundPersistsAndPreviews() async throws {
    let recorder = SettingsNotificationSoundRecorder()

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      } withDependencies: {
        $0.notificationSoundClient.play = { recorder.sounds.append($0) }
      }

      await store.send(.notificationSoundSelected(.glass)) {
        $0.$supatermSettings.withLock {
          $0.notificationSound = .glass
        }
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.notificationSound == .glass)
      #expect(recorder.sounds == [.glass])
    }
  }

  @Test
  func tabMoveHapticsSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.tabMoveHapticsEnabledChanged(false)) {
        $0.$supatermSettings.withLock {
          $0.tabMoveHapticsEnabled = false
        }
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.tabMoveHapticsEnabled)
    }
  }

  @Test
  func glowingPaneRingSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.glowingPaneRingEnabledChanged(false)) {
        $0.$supatermSettings.withLock {
          $0.glowingPaneRingEnabled = false
        }
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.glowingPaneRingEnabled)
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
        $0.pendingSystemNotificationsEnabled = true
      }
      await store.receive(\.systemNotificationsAuthorizationChecked, .authorized, timeout: Duration.zero) {
        $0.pendingSystemNotificationsEnabled = nil
        $0.$supatermSettings.withLock {
          $0.systemNotificationsEnabled = true
        }
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(supatermSettings.systemNotificationsEnabled)
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
          return DesktopNotificationClient.AuthorizationRequestResult(
            granted: false,
            errorMessage: "Mock request error"
          )
        }
      }

      await store.send(.systemNotificationsEnabledChanged(true)) {
        $0.pendingSystemNotificationsEnabled = true
      }
      await store.receive(\.systemNotificationsAuthorizationChecked, .notDetermined, timeout: Duration.zero)
      await store.receive(
        \.systemNotificationsAuthorizationResult,
        DesktopNotificationClient.AuthorizationRequestResult(
          granted: false,
          errorMessage: "Mock request error"
        )
      ) {
        $0.pendingSystemNotificationsEnabled = nil
        $0.alert = notificationPermissionAlert(
          "Supaterm cannot send system notifications.\n\nError: Mock request error")
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.systemNotificationsEnabled)
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
          return DesktopNotificationClient.AuthorizationRequestResult(granted: true, errorMessage: nil)
        }
      }

      await store.send(.systemNotificationsEnabledChanged(true)) {
        $0.pendingSystemNotificationsEnabled = true
      }
      await store.receive(\.systemNotificationsAuthorizationChecked, .denied, timeout: Duration.zero)
      await store.receive(
        \.systemNotificationsAuthorizationResult,
        DesktopNotificationClient.AuthorizationRequestResult(
          granted: false,
          errorMessage: "Authorization status is denied."
        )
      ) {
        $0.pendingSystemNotificationsEnabled = nil
        $0.alert = notificationPermissionAlert(
          "Supaterm cannot send system notifications.\n\nError: Authorization status is denied."
        )
      }

      @Shared(.supatermSettings) var supatermSettings = .default
      #expect(!supatermSettings.systemNotificationsEnabled)
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
}

@MainActor
private final class SettingsNotificationSoundRecorder {
  var sounds: [NotificationSound] = []
}
