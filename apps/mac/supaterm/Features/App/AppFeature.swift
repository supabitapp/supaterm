import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var terminal = TerminalWindowFeature.State()
    var update = UpdateFeature.State()
  }

  enum Action {
    case terminal(TerminalWindowFeature.Action)
    case update(UpdateFeature.Action)
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.terminal, action: \.terminal) {
      TerminalWindowFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { _, action in
      switch action {
      case .terminal:
        return .none

      case .update:
        return .none
      }
    }
  }
}
