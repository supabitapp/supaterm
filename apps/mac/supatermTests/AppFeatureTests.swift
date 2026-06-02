import ComposableArchitecture
import Foundation
import SupatermUpdateFeature
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
      automaticallyChecksForUpdates: true,
      automaticallyDownloadsUpdates: true,
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

  @Test
  func taskLoadsReleaseAnnouncement() async {
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    } withDependencies: {
      $0.releaseAnnouncementClient.synchronize = { .agentForking }
    }

    await store.send(.task)
    await store.receive(\.releaseAnnouncementLoaded) {
      $0.releaseAnnouncement = .agentForking
    }
  }

  @Test
  func taskDoesNotReloadVisibleReleaseAnnouncement() async {
    let synchronizeCount = LockIsolated(0)
    var state = AppFeature.State()
    state.releaseAnnouncement = .agentForking

    let store = TestStore(initialState: state) {
      AppFeature()
    } withDependencies: {
      $0.releaseAnnouncementClient.synchronize = {
        synchronizeCount.withValue { $0 += 1 }
        return nil
      }
    }

    await store.send(.task)
    await store.finish()

    #expect(synchronizeCount.value == 0)
  }

  @Test
  func dismissingReleaseAnnouncementAcknowledgesVersion() async {
    let acknowledgedVersion = LockIsolated<String?>(nil)
    var state = AppFeature.State()
    state.releaseAnnouncement = .agentForking

    let store = TestStore(initialState: state) {
      AppFeature()
    } withDependencies: {
      $0.releaseAnnouncementClient.acknowledge = { version in
        acknowledgedVersion.withValue { $0 = version }
      }
    }

    await store.send(.releaseAnnouncementDismissed) {
      $0.releaseAnnouncement = nil
    }
    await store.finish()

    #expect(acknowledgedVersion.value == "1.3.4")
  }
}
