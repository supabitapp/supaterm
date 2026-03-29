import ComposableArchitecture
import Foundation

private enum ShareServerCancelID {
  static let observation = "ShareServerFeature.observation"
}

@Reducer
struct ShareServerFeature {
  @ObservableState
  struct State: Equatable {
    var snapshot = ShareServerSnapshot()
  }

  enum Action {
    case snapshotReceived(ShareServerSnapshot)
    case startButtonTapped(Int)
    case stopButtonTapped
    case task
  }

  @Dependency(ShareServerClient.self) var shareServerClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .snapshotReceived(let snapshot):
        state.snapshot = snapshot
        return .none

      case .startButtonTapped(let port):
        return .run { [shareServerClient] _ in
          await shareServerClient.start(port, nil)
        }

      case .stopButtonTapped:
        return .run { [shareServerClient] _ in
          await shareServerClient.stop()
        }

      case .task:
        return .run { [shareServerClient] send in
          let snapshots = await shareServerClient.observe()
          for await snapshot in snapshots {
            await send(.snapshotReceived(snapshot))
          }
        }
        .cancellable(id: ShareServerCancelID.observation, cancelInFlight: true)
      }
    }
  }
}
