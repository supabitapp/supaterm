import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalTabFeatureTests {
  @Test
  func incrementIncreasesCount() async {
    let store = TestStore(initialState: .fixture()) {
      TerminalTabFeature()
    }

    await store.send(.incrementButtonTapped) {
      $0.count = 1
    }
  }

  @Test
  func decrementDecreasesCount() async {
    let store = TestStore(initialState: .fixture(count: 2)) {
      TerminalTabFeature()
    }

    await store.send(.decrementButtonTapped) {
      $0.count = 1
    }
  }
}

extension TerminalTabFeature.State {
  fileprivate static func fixture(
    id: UUID = UUID(uuidString: "10000000-0000-0000-0000-000000000000")!,
    title: String = "Fixture",
    symbol: String = "terminal",
    isPinned: Bool = false,
    count: Int = 0,
  ) -> Self {
    Self(id: id, title: title, symbol: symbol, isPinned: isPinned, count: count)
  }
}
