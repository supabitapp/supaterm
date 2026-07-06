import ComposableArchitecture
import Foundation

extension SettingsFeature {
  func reduceGeneral(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .appearanceModeSelected(let appearanceMode):
      state.appearanceMode = appearanceMode
      return persist(state)

    case .analyticsEnabledChanged(let isEnabled):
      state.analyticsEnabled = isEnabled
      return persist(state)

    case .confirmQuitModeSelected(let mode):
      state.confirmQuitMode = mode
      return persist(state)

    case .crashReportsEnabledChanged(let isEnabled):
      state.crashReportsEnabled = isEnabled
      return persist(state)

    case .glowingPaneRingEnabledChanged(let isEnabled):
      state.glowingPaneRingEnabled = isEnabled
      return persist(state)

    case .restoreTerminalLayoutEnabledChanged(let isEnabled):
      state.restoreTerminalLayoutEnabled = isEnabled
      return persist(state)

    case .zmxSessionsEnabledChanged(let isEnabled):
      state.zmxSessionsEnabled = isEnabled
      state.alert = zmxRestartRequiredAlert()
      return persist(state)

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
