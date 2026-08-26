import ComposableArchitecture
import Foundation
import SupatermUpdateFeature
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func ownedReleaseActionOpensTheFeedDownload() async throws {
    let updatesThrough = try #require(LicenseDay("2026-08-21"))
    let entitlement = LicenseEntitlement(
      licenseID: "00112233445566778899aabbccddeeff",
      deviceID: "device",
      status: .active,
      updatesThrough: updatesThrough,
      revision: 1,
      issuedAt: 1,
      revocationReason: nil,
      signedToken: "signed-token"
    )
    var client = LicenseClient.testValue
    client.load = {
      LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    }
    let runtime = LicenseRuntime(client: client)
    let downloadURL = URL(string: "https://supaterm.com/download/v26.3.0/supaterm.dmg")!
    let requestedDay = LockIsolated<LicenseDay?>(nil)
    let openedURL = LockIsolated<URL?>(nil)
    let store = TestStore(initialState: AppLicenseFeature.State(runtime: runtime)) {
      AppLicenseFeature(runtime: runtime)
    } withDependencies: {
      $0.analyticsClient.capture = { _ in }
      $0.externalNavigationClient.open = { url in
        openedURL.withValue { $0 = url }
        return true
      }
      $0.updateClient.newestOwnedReleaseURL = { day in
        requestedDay.withValue { $0 = day }
        return downloadURL
      }
    }

    await store.send(.license(.ownedReleaseButtonTapped))
    await store.finish()

    #expect(requestedDay.value == updatesThrough)
    #expect(openedURL.value == downloadURL)
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
    await store.receive(\.socket.task)
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
    await store.receive(\.socket.task)
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
}
