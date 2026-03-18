import ComposableArchitecture
import Foundation
import SupatermCLIShared

private enum SocketControlCancelID {
  static let requests = "SocketControlFeature.requests"
}

@Reducer
struct SocketControlFeature {
  @ObservableState
  struct State: Equatable {
    var socketPath: String?
    var startErrorMessage: String?
  }

  enum Action {
    case requestReceived(SocketControlClient.Request)
    case started(String)
    case startFailed(String)
    case task
  }

  @Dependency(SocketControlClient.self) var socketControlClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .requestReceived(let request):
        let response =
          if request.payload.method == SupatermSocketMethod.systemPing {
            SupatermSocketResponse.ok(
              id: request.payload.id,
              result: ["pong": .bool(true)]
            )
          } else {
            SupatermSocketResponse.error(
              id: request.payload.id,
              code: "method_not_found",
              message: "Unknown method '\(request.payload.method)'."
            )
          }

        return .run { [socketControlClient] _ in
          await socketControlClient.reply(request.handle, response)
        }

      case .started(let socketPath):
        state.socketPath = socketPath
        state.startErrorMessage = nil
        return .none

      case .startFailed(let message):
        state.startErrorMessage = message
        return .none

      case .task:
        return .run { [socketControlClient] send in
          do {
            let socketPath = try await socketControlClient.start()
            await send(.started(socketPath))
            let requests = await socketControlClient.requests()
            for await request in requests {
              await send(.requestReceived(request))
            }
          } catch {
            await send(.startFailed(error.localizedDescription))
          }
        }
        .cancellable(id: SocketControlCancelID.requests, cancelInFlight: true)
      }
    }
  }
}
