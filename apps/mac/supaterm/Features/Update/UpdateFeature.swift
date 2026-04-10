import ComposableArchitecture
import SupatermSupport

private enum UpdateFeatureCancelID {
  static let observation = "UpdateFeature.observation"
}

@Reducer
public struct UpdateFeature {
  @ObservableState
  public struct State: Equatable {
    public var canCheckForUpdates: Bool
    public var phase: UpdatePhase

    public init(
      canCheckForUpdates: Bool = false,
      phase: UpdatePhase = .idle
    ) {
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
    }
  }

  public enum Action {
    case perform(UpdateUserAction)
    case task
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
  }

  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(UpdateClient.self) var updateClient

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .perform(let action):
        if action == .checkForUpdates && !state.canCheckForUpdates {
          return .none
        }
        if action == .checkForUpdates {
          analyticsClient.capture("update_checked")
        }
        return .run { [updateClient] _ in
          await updateClient.perform(action)
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
        state.phase = snapshot.phase
        return .none
      }
    }
  }
}
