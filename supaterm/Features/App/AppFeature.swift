import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var selectedTabID = BrowserTabCatalog.defaultSelectedTabID
  }

  enum Action {
    case tabSelected(BrowserTabID)
  }

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .tabSelected(let tabID):
        guard state.selectedTabID != tabID else { return .none }
        state.selectedTabID = tabID
        return .none
      }
    }
  }
}
