import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var terminal = TerminalSceneFeature.State()
    var update = UpdateFeature.State()
  }

  enum Action {
    case quitRequested(ObjectIdentifier)
    case terminal(TerminalSceneFeature.Action)
    case update(UpdateFeature.Action)
  }

  @Dependency(AppTerminationClient.self) var appTerminationClient

  var body: some Reducer<State, Action> {
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
          return .run { [appTerminationClient] _ in
            await appTerminationClient.reply(true)
          }
        }
        return .send(.terminal(.quitRequested(windowID: windowID)))

      case .terminal:
        return .none

      case .update:
        return .none
      }
    }
  }
}
