import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func reducerStartsWithInitialSelectedTab() {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    #expect(store.state.tabs.selectedTab.title == "Command Deck")
  }

  @Test
  func tabActionsRouteToChildFeature() async {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    let targetID = store.state.tabs.regularTabs[2].id

    await store.send(.tabs(.tabSelected(targetID))) {
      $0.tabs.selectedTabID = targetID
    }
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
