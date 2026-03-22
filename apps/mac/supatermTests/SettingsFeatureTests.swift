import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct SettingsFeatureTests {
  @Test
  func initialStateStartsOnGeneralTab() {
    let state = SettingsFeature.State()

    #expect(state.selectedTab == .general)
  }

  @Test
  func tabSelectionUpdatesState() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    }

    await store.send(.tabSelected(.updates)) {
      $0.selectedTab = .updates
    }

    await store.send(.tabSelected(.about)) {
      $0.selectedTab = .about
    }
  }
}
