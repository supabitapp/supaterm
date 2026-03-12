import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
  }

  enum Action {
  }

  var body: some Reducer<State, Action> {
    EmptyReducer()
  }
}
