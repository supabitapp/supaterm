import ComposableArchitecture

private enum UpdateFeatureCancelID {
  static let observation = "UpdateFeature.observation"
}

@Reducer
struct UpdateFeature {
  @ObservableState
  struct State: Equatable {
    var canCheckForUpdates = false
    var phase = UpdatePhase()
  }

  enum Action {
    case checkForUpdatesButtonTapped
    case task
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
  }

  @Dependency(UpdateClient.self) var updateClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .checkForUpdatesButtonTapped:
        guard state.canCheckForUpdates else { return .none }
        return .run { [updateClient] _ in
          await updateClient.checkForUpdates()
        }

      case .task:
        return .run { [updateClient] send in
          await updateClient.start()
          let stream = await updateClient.observe()
          for await snapshot in stream {
            await send(.updateClientSnapshotReceived(snapshot))
          }
        }
        .cancellable(id: UpdateFeatureCancelID.observation, cancelInFlight: true)

      case .updateClientSnapshotReceived(let snapshot):
        state.canCheckForUpdates = snapshot.canCheckForUpdates
        return .none
      }
    }
  }
}
