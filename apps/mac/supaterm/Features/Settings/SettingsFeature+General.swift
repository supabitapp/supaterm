import ComposableArchitecture

extension SettingsFeature {
  func reduceGeneral(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .appearanceModeSelected(let appearanceMode):
      state.appearanceMode = appearanceMode
      return persist(state)

    case .analyticsEnabledChanged(let isEnabled):
      state.analyticsEnabled = isEnabled
      return persist(state)

    case .crashReportsEnabledChanged(let isEnabled):
      state.crashReportsEnabled = isEnabled
      return persist(state)

    case .glowingPaneRingEnabledChanged(let isEnabled):
      state.glowingPaneRingEnabled = isEnabled
      return persist(state)

    case .newTabPositionSelected(let newTabPosition):
      state.newTabPosition = newTabPosition
      return persist(state)

    case .restoreTerminalLayoutEnabledChanged(let isEnabled):
      state.restoreTerminalLayoutEnabled = isEnabled
      return persist(state)

    default:
      return .none
    }
  }
}
