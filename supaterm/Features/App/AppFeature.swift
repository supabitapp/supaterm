import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var tabs = TerminalTabsFeature.State()
    var update = UpdateFeature.State()
  }

  enum Action {
    case tabs(TerminalTabsFeature.Action)
    case update(UpdateFeature.Action)
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.tabs, action: \.tabs) {
      TerminalTabsFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { _, action in
      switch action {
      case .tabs, .update:
        return .none
      }
    }
  }
}
