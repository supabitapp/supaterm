import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func reducerStartsWithEmptyState() {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    #expect(store.state == AppFeature.State())
  }
}
