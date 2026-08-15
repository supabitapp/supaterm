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

    case .zmxSessionsEnabledChanged(let isEnabled):
      state.alert = zmxRestartRequiredAlert()
      updateSettings(&state) {
        $0.zmxSessionsEnabled = isEnabled
      }
      return .none

    default:
      return .none
    }
  }

  func zmxRestartRequiredAlert() -> AlertState<Alert> {
    AlertState {
      TextState("Restart Required")
    } actions: {
      ButtonState(role: .cancel, action: .dismiss) {
        TextState("OK")
      }
    } message: {
      TextState("Restart Supaterm for zmx session changes to take effect.")
    }
  }
}
