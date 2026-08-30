import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var subtitle: String { "Supaterm for iOS is ready." }
    var title: String { "Supaterm" }
  }

  enum Action {}

  var body: some Reducer<State, Action> {
    EmptyReducer()
  }
}
