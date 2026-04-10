import ComposableArchitecture
import Foundation

extension SettingsFeature {
  func reduceNotifications(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .systemNotificationsEnabledChanged(let isEnabled):
      state.alert = nil
      state.systemNotificationsEnabled = isEnabled
      guard isEnabled else {
        return persist(state)
      }
      return .run { [desktopNotificationClient] send in
        let status = await desktopNotificationClient.authorizationStatus()
        await send(.systemNotificationsAuthorizationChecked(status))
      }

    case .systemNotificationsAuthorizationChecked(let status):
      switch status {
      case .authorized:
        return persist(state)

      case .denied:
        return .send(
          .systemNotificationsAuthorizationResult(
            .init(granted: false, errorMessage: "Authorization status is denied.")
          )
        )

      case .notDetermined:
        return .run { [desktopNotificationClient] send in
          let result = await desktopNotificationClient.requestAuthorization()
          await send(.systemNotificationsAuthorizationResult(result))
        }
      }

    case .systemNotificationsAuthorizationResult(let result):
      guard result.granted else {
        state.systemNotificationsEnabled = false
        state.alert = notificationPermissionAlert(errorMessage: result.errorMessage)
        return persist(state)
      }
      return persist(state)

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
