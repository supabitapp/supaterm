import AppKit
import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var socket = SocketControlFeature.State()
    var terminal = TerminalSceneFeature.State()
    var update = UpdateFeature.State()
  }

  enum Action {
    case quitRequested(ObjectIdentifier)
    case socket(SocketControlFeature.Action)
    case terminal(TerminalSceneFeature.Action)
    case update(UpdateFeature.Action)
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.socket, action: \.socket) {
      SocketControlFeature()
    }

    Scope(state: \.terminal, action: \.terminal) {
      TerminalSceneFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { state, action in
      switch action {
      case .quitRequested(let windowID):
        if state.update.phase.bypassesQuitConfirmation {
          return .run { _ in
            await MainActor.run {
              NSApplication.shared.reply(toApplicationShouldTerminate: true)
            }
          }
        }
        return .send(.terminal(.quitRequested(windowID: windowID)))

      case .socket:
        return .none

      case .terminal:
        return .none

      case .update:
        return .none
      }
    }
  }
}
