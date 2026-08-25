import ComposableArchitecture
import Foundation
import SupatermSupport

extension SettingsFeature {
  func reduceGeneral(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .appearanceModeSelected(let appearanceMode):
      updateSettings(&state) {
        $0.appearanceMode = appearanceMode
      }
      return .none

    case .analyticsEnabledChanged(let isEnabled):
      updateSettings(&state) {
        $0.analyticsEnabled = isEnabled
      }
      return .none

    case .crashReportsEnabledChanged(let isEnabled):
      updateSettings(&state) {
        $0.crashReportsEnabled = isEnabled
      }
      return .none

    case .glowingPaneRingEnabledChanged(let isEnabled):
      updateSettings(&state) {
        $0.glowingPaneRingEnabled = isEnabled
      }
      return .none

    case .restoreTerminalLayoutEnabledChanged(let isEnabled):
      updateSettings(&state) {
        $0.restoreTerminalLayoutEnabled = isEnabled
      }
      return .none

    case .sessionPersistenceEnabledChanged(let isEnabled):
      state.alert = sessionPersistenceRestartRequiredAlert()
      updateSettings(&state) {
        $0.sessionPersistenceEnabled = isEnabled
      }
      return .none

    default:
      return .none
    }
  }

  func sessionPersistenceRestartRequiredAlert() -> AlertState<Alert> {
    AlertState {
      TextState("Restart Required")
    } actions: {
      ButtonState(role: .cancel, action: .dismiss) {
        TextState("OK")
      }
    } message: {
      TextState("Restart Supaterm for session persistence changes to take effect.")
    }
  }
}
