import ComposableArchitecture
import Foundation

@Reducer
struct TerminalTabFeature {
  @ObservableState
  struct State: Equatable, Identifiable {
    let id: UUID
    var title: String
    var symbol: String
    var isPinned: Bool
    var count = 0

    var tone: TerminalTone {
      TerminalTone.allCases[abs(id.uuidString.hashValue) % TerminalTone.allCases.count]
    }

    static func makeNewTab(id: UUID) -> Self {
      Self(id: id, title: "New Tab", symbol: "terminal", isPinned: false)
    }
  }

  enum Action {
    case decrementButtonTapped
    case incrementButtonTapped
  }

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .decrementButtonTapped:
        state.count -= 1
        return .none

      case .incrementButtonTapped:
        state.count += 1
        return .none
      }
    }
  }
}
