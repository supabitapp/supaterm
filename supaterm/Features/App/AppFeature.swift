import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var update = UpdateFeature.State()
  }

  enum Action {
    case update(UpdateFeature.Action)
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { _, action in
      switch action {
      case .update:
        return .none
      }
    }
  }
}
