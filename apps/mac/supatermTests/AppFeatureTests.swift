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
      $0.$update.withLock {
        $0.canCheckForUpdates = true
        $0.phase = .checking
      }
    }
  }

  @Test
  func taskLoadsReleaseAnnouncement() async {
    let (announcements, continuation) = AsyncStream.makeStream(
      of: ReleaseAnnouncement?.self
    )
    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    } withDependencies: {
      configureLifecycleDependencies(&$0)
      $0.releaseAnnouncementClient.synchronize = {
        for await announcement in announcements {
          return announcement
        }
        return nil
      }
    }

    await store.send(.task) {
      $0.$releaseAnnouncementStatus.withLock { $0 = .loading }
    }
    await store.receive(\.license.task)
    await store.receive(\.socket.task)
    await store.receive(\.update.task)
    await store.receive(\.license.refreshRequested)
    continuation.yield(.agentForking)
    continuation.finish()
    await store.receive(\.releaseAnnouncementLoaded) {
      $0.$releaseAnnouncementStatus.withLock { $0 = .loaded(.agentForking) }
    }
  }

  @Test
  func taskDoesNotReloadVisibleReleaseAnnouncement() async {
    let synchronizeCount = LockIsolated(0)
    let process = Shared(
      value: AppFeature.ProcessState(
        releaseAnnouncementStatus: .loaded(.agentForking)
      )
    )

    let store = TestStore(initialState: AppFeature.State(process: process)) {
      AppFeature()
    } withDependencies: {
      configureLifecycleDependencies(&$0)
      $0.releaseAnnouncementClient.synchronize = {
        synchronizeCount.withValue { $0 += 1 }
        return nil
      }
    }

    await store.send(.task)
    await store.receive(\.license.task)
    await store.receive(\.socket.task)
    await store.receive(\.update.task)
    await store.receive(\.license.refreshRequested)
    await store.finish()

    #expect(synchronizeCount.value == 0)
  }

  @Test
  func dismissingReleaseAnnouncementAcknowledgesVersion() async {
    let acknowledgedVersion = LockIsolated<String?>(nil)
    let process = Shared(
      value: AppFeature.ProcessState(
        releaseAnnouncementStatus: .loaded(.agentForking)
      )
    )

    let store = TestStore(initialState: AppFeature.State(process: process)) {
      AppFeature()
    } withDependencies: {
      $0.releaseAnnouncementClient.acknowledge = { version in
        acknowledgedVersion.withValue { $0 = version }
      }
    }

    await store.send(.releaseAnnouncementDismissed) {
      $0.$releaseAnnouncementStatus.withLock { $0 = .loaded(nil) }
    }
    await store.finish()

    #expect(acknowledgedVersion.value == "1.3.4")
  }

  @Test
  func processStateIsSharedAcrossWindowStores() async {
    let process = Shared(
      value: AppFeature.ProcessState(
        releaseAnnouncementStatus: .loading
      )
    )
    let first = TestStore(initialState: AppFeature.State(process: process)) {
      AppFeature()
    }
    let second = TestStore(initialState: AppFeature.State(process: process)) {
      AppFeature()
    }

    await first.send(.releaseAnnouncementLoaded(.agentForking)) {
      $0.$releaseAnnouncementStatus.withLock { $0 = .loaded(.agentForking) }
    }

    #expect(second.state.releaseAnnouncement == .agentForking)
  }
}

private func configureLifecycleDependencies(_ dependencies: inout DependencyValues) {
  dependencies.socketControlClient.start = { throw CancellationError() }
  dependencies.updateClient.observe = { AsyncStream { $0.finish() } }
  dependencies.updateClient.start = {}
}
