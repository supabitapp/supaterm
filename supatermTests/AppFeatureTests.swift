import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func reducerStartsWithDefaultSelectedTab() {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    #expect(store.state.selectedTabID == BrowserTabCatalog.defaultSelectedTabID)
  }

  @Test
  func tabSelectionUpdatesSelectedTabID() async {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    await store.send(.tabSelected(.windowStyling)) {
      $0.selectedTabID = .windowStyling
    }
  }

  @Test
  func selectingCurrentTabIsStable() async {
    var initialState = AppFeature.State()
    initialState.selectedTabID = .sessions

    let store = TestStore(initialState: initialState) {
      AppFeature()
    }

    await store.send(.tabSelected(.sessions))
    #expect(store.state.selectedTabID == .sessions)
  }
}
