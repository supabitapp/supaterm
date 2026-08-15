import ComposableArchitecture
import SupatermSupport

extension SettingsFeature {
  func reduceAdvanced(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .verboseLoggingEnabledChanged(let isEnabled):
      SupatermLog.setVerboseLoggingEnabled(isEnabled)
      updateSettings(&state) {
        $0.verboseLoggingEnabled = isEnabled
      }
      return .none

    default:
      return .none
    }
  }
}
