import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func initialStateStartsIdle() {
    let state = AppFeature.State()

    #expect(state.update.canCheckForUpdates == false)
    #expect(state.update.phase == .idle)
  }

  @Test
  func updateActionsRouteToChildFeature() async {
    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .checking
    )

    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    await store.send(.update(.updateClientSnapshotReceived(snapshot))) {
      $0.update.canCheckForUpdates = true
      $0.update.phase = .checking
    }
  }
}
