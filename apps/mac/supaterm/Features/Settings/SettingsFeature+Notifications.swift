import ComposableArchitecture
import Foundation
import SupatermSupport

extension SettingsFeature {
  func reduceNotifications(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .systemNotificationsEnabledChanged(let isEnabled):
      state.alert = nil
      guard isEnabled else {
        state.pendingSystemNotificationsEnabled = nil
        updateSettings(&state) {
          $0.systemNotificationsEnabled = false
        }
        return .none
      }
      state.pendingSystemNotificationsEnabled = true
      return .run { [desktopNotificationClient] send in
        let status = await desktopNotificationClient.authorizationStatus()
        await send(.systemNotificationsAuthorizationChecked(status))
      }

    case .systemNotificationsAuthorizationChecked(let status):
      switch status {
      case .authorized:
        state.pendingSystemNotificationsEnabled = nil
        updateSettings(&state) {
          $0.systemNotificationsEnabled = true
        }
        return .none

      case .denied:
        return .send(
          .systemNotificationsAuthorizationResult(
            DesktopNotificationClient.AuthorizationRequestResult(
              granted: false,
              errorMessage: "Authorization status is denied."
            )
          )
        )

      case .notDetermined:
        return .run { [desktopNotificationClient] send in
          let result = await desktopNotificationClient.requestAuthorization()
          await send(.systemNotificationsAuthorizationResult(result))
        }
      }

    case .systemNotificationsAuthorizationResult(let result):
      state.pendingSystemNotificationsEnabled = nil
      guard result.granted else {
        state.alert = notificationPermissionAlert(errorMessage: result.errorMessage)
        updateSettings(&state) {
          $0.systemNotificationsEnabled = false
        }
        return .none
      }
      updateSettings(&state) {
        $0.systemNotificationsEnabled = true
      }
      return .none

    default:
      return .none
    }
  }

  func notificationPermissionAlert(errorMessage: String?) -> AlertState<Alert> {
    let message: String
    if let errorMessage, !errorMessage.isEmpty {
      message =
        "Supaterm cannot send system notifications.\n\n"
        + "Error: \(errorMessage)"
    } else {
      message = "Supaterm cannot send system notifications while permission is denied."
    }
    return AlertState {
      TextState("Enable Notifications in System Settings")
    } actions: {
      ButtonState(action: .openSystemNotificationSettings) {
        TextState("Open System Settings")
      }
      ButtonState(role: .cancel, action: .dismiss) {
        TextState("Cancel")
      }
    } message: {
      TextState(message)
    }
  }
}
