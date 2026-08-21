import Clocks
import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermSupport

@MainActor
struct LicenseFeatureTests {
  @Test
  func activationLinkOnlyPrefillsKey() async {
    let store = TestStore(initialState: LicenseFeature.State()) {
      LicenseFeature()
    }

    await store.send(.prefillKey("license-key")) {
      $0.key = "license-key"
      $0.errorMessage = nil
    }

    #expect(store.state.phase == .idle)
    #expect(store.state.entitlement == nil)
  }

  @Test
  func expiredLicenseRefreshesWhenAppBecomesActive() async {
    let expired = entitlement(updatesThrough: day("2000-01-01"))
    let renewed = paidEntitlement()
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(
          entitlement: expired,
          hasLicenseKey: true
        )
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.licenseClient.refresh = { renewed }
    }

    await store.send(.applicationBecameActive)
    await store.receive(\.refreshRequested) {
      $0.phase = .refreshing
    }
    await store.receive(\.refreshResponse) {
      $0.entitlement = renewed
      $0.phase = .idle
    }
  }

  @Test
  func ownedReleaseActionOpensLicensePageAndCapturesEvent() async {
    let expired = entitlement(updatesThrough: day("2000-01-01"))
    let events = LockIsolated<[String]>([])
    let openedURL = LockIsolated<URL?>(nil)
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(
          entitlement: expired,
          hasLicenseKey: true
        )
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        events.withValue { $0.append(event) }
      }
      $0.externalNavigationClient.open = { url in
        openedURL.withValue { $0 = url }
        return true
      }
    }

    await store.send(.ownedReleaseButtonTapped)
    await store.finish()

    #expect(events.value == ["license_owned_release_download_opened"])
    #expect(openedURL.value == LicensePortalURL.license(expired.licenseID))
  }

  @Test
  func tabLimitAnalyticsCarriesOnlyOrigin() async {
    let captures = LockIsolated<[(String, [String: String])]>([])
    let store = TestStore(initialState: LicenseFeature.State()) {
      LicenseFeature()
    } withDependencies: {
      $0.analyticsClient.captureProperties = { event, properties in
        captures.withValue { $0.append((event, properties)) }
      }
    }

    await store.send(.tabLimitHit(.socket))

    #expect(captures.value.count == 1)
    #expect(captures.value.first?.0 == "tab_limit_hit")
    #expect(captures.value.first?.1 == ["origin": "socket"])
  }

  @Test
  func activationURLAcceptsOnlyPrefillRoute() {
    #expect(
      LicenseActivationURL.key(
        from: URL(string: "supaterm://activate?key=license-key")!
      ) == "license-key"
    )
    #expect(
      LicenseActivationURL.key(
        from: URL(string: "https://activate?key=license-key")!
      ) == nil
    )
    #expect(
      LicenseActivationURL.key(
        from: URL(string: "supaterm://other?key=license-key")!
      ) == nil
    )
  }

  @Test
  func activationStoresEntitlementAndCapturesEvent() async {
    let clock = TestClock()
    let entitlement = paidEntitlement()
    let events = LockIsolated<[String]>([])
    let activatedKey = LockIsolated<String?>(nil)
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(entitlement: nil, hasLicenseKey: false)
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.continuousClock = clock
      $0.analyticsClient.capture = { event in
        events.withValue { $0.append(event) }
      }
      $0.licenseClient.activate = { key in
        activatedKey.withValue { $0 = key }
        return entitlement
      }
    }

    await store.send(.keyChanged("license-key")) {
      $0.key = "license-key"
      $0.errorMessage = nil
    }
    await store.send(.activationButtonTapped) {
      $0.phase = .activating
    }
    await store.receive(\.activationResponse) {
      $0.entitlement = entitlement
      $0.hasLicenseKey = true
      $0.key = ""
      $0.phase = .idle
    }

    #expect(activatedKey.value == "license-key")
    #expect(events.value == ["license_activated"])
    await store.send(.shutdown)
    await store.finish()
  }

  @Test
  func offlineDeactivationKeepsEntitlement() async {
    let entitlement = paidEntitlement()
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(
          entitlement: entitlement,
          hasLicenseKey: true
        )
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.licenseClient.deactivate = {
        throw LicenseClientError.connectionRequired
      }
    }

    await store.send(.deactivationButtonTapped) {
      $0.errorMessage = nil
      $0.phase = .deactivating
    }
    await store.receive(\.deactivationResponse) {
      $0.errorMessage =
        "Deactivation needs a connection. If you cannot reconnect, email license@supaterm.com."
      $0.phase = .idle
    }

    #expect(store.state.entitlement == entitlement)
    #expect(store.state.hasLicenseKey)
  }

  @Test
  func cachedEntitlementRemainsPaidWhileRefreshRuns() async {
    let refreshStarted = AsyncStream.makeStream(of: Void.self)
    let refreshResponse = AsyncStream.makeStream(of: LicenseEntitlement.self)
    let clock = TestClock()
    let entitlement = paidEntitlement()
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(
          entitlement: entitlement,
          hasLicenseKey: true
        )
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.continuousClock = clock
      $0.licenseClient.refresh = {
        refreshStarted.continuation.yield()
        for await entitlement in refreshResponse.stream {
          return entitlement
        }
        throw CancellationError()
      }
    }

    await store.send(.task)
    await store.receive(\.refreshRequested) {
      $0.phase = .refreshing
    }
    for await _ in refreshStarted.stream {
      break
    }

    #expect(store.state.mode == .paid)
    #expect(store.state.entitlement == entitlement)

    await store.send(.shutdown) {
      $0.phase = .idle
    }
    refreshStarted.continuation.finish()
    refreshResponse.continuation.finish()
    await store.finish()
  }

  @Test
  func refreshFailureKeepsCachedEntitlement() async {
    let entitlement = paidEntitlement()
    let store = TestStore(
      initialState: LicenseFeature.State(
        snapshot: LicenseClient.Snapshot(
          entitlement: entitlement,
          hasLicenseKey: true
        )
      )
    ) {
      LicenseFeature()
    } withDependencies: {
      $0.licenseClient.refresh = {
        throw LicenseClientError.connectionRequired
      }
    }

    await store.send(.refreshRequested) {
      $0.phase = .refreshing
    }
    await store.receive(\.refreshResponse) {
      $0.phase = .idle
    }

    #expect(store.state.mode == .paid)
    #expect(store.state.entitlement == entitlement)
  }

  private func paidEntitlement() -> LicenseEntitlement {
    entitlement(updatesThrough: day("2099-01-01"))
  }

  private func entitlement(updatesThrough: LicenseDay) -> LicenseEntitlement {
    LicenseEntitlement(
      licenseID: "00112233445566778899aabbccddeeff",
      deviceID: "device",
      status: .active,
      updatesThrough: updatesThrough,
      revision: 1,
      issuedAt: 1,
      revocationReason: nil,
      signedToken: "signed-token"
    )
  }

  private func day(_ value: String) -> LicenseDay {
    guard let day = LicenseDay(value) else {
      preconditionFailure("Invalid test license day")
    }
    return day
  }
}
