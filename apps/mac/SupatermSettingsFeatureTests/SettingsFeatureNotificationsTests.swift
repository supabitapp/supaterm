import ComposableArchitecture
import Sharing
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureNotificationsTests {
  @Test
  func glowingPaneRingSettingPersistsPrefs() async throws {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: SettingsFeature.State()) {
        SettingsFeature()
      }

      await store.send(.glowingPaneRingEnabledChanged(false)) {
        $0.glowingPaneRingEnabled = false
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
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.authorized), timeout: 0)

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
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.notDetermined), timeout: 0)
      await store.receive(
        .systemNotificationsAuthorizationResult(
          DesktopNotificationClient.AuthorizationRequestResult(
            granted: false,
            errorMessage: "Mock request error"
          )
        )
      ) {
        $0.systemNotificationsEnabled = false
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
        $0.systemNotificationsEnabled = true
      }
      await store.receive(.systemNotificationsAuthorizationChecked(.denied), timeout: 0)
      await store.receive(
        .systemNotificationsAuthorizationResult(
          DesktopNotificationClient.AuthorizationRequestResult(
            granted: false,
            errorMessage: "Authorization status is denied."
          )
        )
      ) {
        $0.systemNotificationsEnabled = false
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
