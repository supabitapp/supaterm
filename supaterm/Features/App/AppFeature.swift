import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var selectedTabID = TerminalTabCatalog.defaultSelectedTabID
    var update = UpdateFeature.State()
  }

  enum Action {
    case tabSelected(TerminalTabID)
    case update(UpdateFeature.Action)
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { state, action in
      switch action {
      case .tabSelected(let tabID):
        guard state.selectedTabID != tabID else { return .none }
        state.selectedTabID = tabID
        return .none

      case .update:
        return .none
      }
    }
  }
}
