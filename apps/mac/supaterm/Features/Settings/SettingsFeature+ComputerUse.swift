import ComposableArchitecture

extension SettingsFeature {
  func reduceComputerUse(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .computerUsePermissionsRefreshRequested:
      state.computerUse.isRefreshing = true
      return .run { [computerUsePermissionsClient] send in
        let snapshot = await computerUsePermissionsClient.snapshot()
        await send(.computerUsePermissionsRefreshed(snapshot))
      }

    case .computerUsePermissionsRefreshed(let snapshot):
      state.computerUse.accessibility = snapshot.accessibility
      state.computerUse.screenRecording = snapshot.screenRecording
      state.computerUse.isRefreshing = false
      return .none

    case .computerUsePermissionGrantButtonTapped(let permission):
      state.computerUse.isRefreshing = true
      return .run { [computerUsePermissionsClient] send in
        let snapshot = await computerUsePermissionsClient.request(permission)
        await send(.computerUsePermissionsRefreshed(snapshot))
      }

    case .computerUsePermissionSettingsButtonTapped(let permission):
      return .run { [computerUsePermissionsClient] _ in
        await computerUsePermissionsClient.openSettings(permission)
      }

    case .computerUseShowAgentCursorChanged(let isEnabled):
      state.computerUse.showAgentCursor = isEnabled
      return persist(state)

    default:
      return .none
    }
  }
}
