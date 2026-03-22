import ComposableArchitecture
import Foundation

@Reducer
struct SettingsFeature {
  @ObservableState
  struct State: Equatable {
    var selectedTab = Tab.general
  }

  enum Action {
    case tabSelected(Tab)
  }

  enum Tab: String, CaseIterable, Equatable, Hashable {
    case general
    case updates
    case about

    var symbol: String {
      switch self {
      case .general:
        "slider.horizontal.3"
      case .updates:
        "arrow.trianglehead.clockwise"
      case .about:
        "sparkles.rectangle.stack"
      }
    }

    var title: String {
      rawValue.capitalized
    }

    var detail: String {
      switch self {
      case .general:
        "Startup, chrome, and behavior"
      case .updates:
        "Release flow and delivery"
      case .about:
        "Build, engine, and links"
      }
    }
  }

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .tabSelected(let tab):
        state.selectedTab = tab
        return .none
      }
    }
  }
}
