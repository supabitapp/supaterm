import Clocks
import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport

@MainActor
struct LicenseFeatureTests {
  @Test
  func activationLinkActivatesKey() async {
    let entitlement = paidEntitlement()
    let activatedKey = LockIsolated<String?>(nil)
    let runtime = runtime {
      $0.activate = { key in
        activatedKey.withValue { $0 = key }
        return entitlement
      }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    } withDependencies: {
      $0.analyticsClient.capture = { _ in }
    }

    await store.send(.activationLinkOpened("license-key")) {
      $0.key = "license-key"
      $0.$session.withLock { $0.phase = .activating }
    }
    await store.receive(\.activationResponse) {
      $0.key = ""
      $0.$session.withLock {
        $0.entitlement = entitlement
        $0.hasLicenseKey = true
        $0.phase = .idle
      }
    }

    #expect(activatedKey.value == "license-key")
    #expect(store.state.phase == .idle)
    #expect(store.state.entitlement == entitlement)
  }

  @Test
  func expiredLicenseRefreshesWhenAppBecomesActive() async {
    let expired = entitlement(updatesThrough: day("2000-01-01"))
    let renewed = paidEntitlement()
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: expired, hasLicenseKey: true)
    ) {
      $0.refresh = { renewed }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    }

    await store.send(.applicationBecameActive) {
      $0.$session.withLock { $0.phase = .refreshing }
    }
    await store.receive(\.refreshResponse) {
      $0.$session.withLock {
        $0.entitlement = renewed
        $0.phase = .idle
      }
    }
  }

  @Test
  func ownedReleaseActionCapturesEvent() async {
    let expired = entitlement(updatesThrough: day("2000-01-01"))
    let events = LockIsolated<[String]>([])
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: expired, hasLicenseKey: true)
    )
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        events.withValue { $0.append(event) }
      }
    }

    await store.send(.ownedReleaseButtonTapped)
    await store.finish()

    #expect(events.value == ["license_owned_release_download_opened"])
  }

  @Test
  func tabLimitAnalyticsCarriesOnlyOrigin() async {
    let captures = LockIsolated<[(String, [String: String])]>([])
    let runtime = runtime()
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
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
  func activationURLAcceptsOnlyActivationRoute() {
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
    let responsePhase = LockIsolated<LicenseFeaturePhase?>(nil)
    let activatedKey = LockIsolated<String?>(nil)
    let runtime = runtime {
      $0.activate = { key in
        activatedKey.withValue { $0 = key }
        return entitlement
      }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    } withDependencies: {
      $0.continuousClock = clock
      $0.analyticsClient.capture = { event in
        events.withValue { $0.append(event) }
        responsePhase.withValue { $0 = runtime.session.wrappedValue.phase }
      }
    }

    await store.send(.keyChanged("license-key")) {
      $0.key = "license-key"
      $0.error = nil
    }
    await store.send(.activationButtonTapped) {
      $0.$session.withLock { $0.phase = .activating }
    }
    await store.receive(\.activationResponse) {
      $0.key = ""
      $0.$session.withLock {
        $0.entitlement = entitlement
        $0.hasLicenseKey = true
        $0.phase = .idle
      }
    }

    #expect(activatedKey.value == "license-key")
    #expect(events.value == ["license_activated"])
    #expect(responsePhase.value == .activating)
    #expect(store.state.phase == .idle)
    await store.send(.shutdown)
    await store.finish()
  }

  @Test
  func offlineDeactivationKeepsEntitlement() async {
    let entitlement = paidEntitlement()
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    ) {
      $0.deactivate = {
        throw LicenseClientError.connectionRequired
      }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    }

    await store.send(.deactivationButtonTapped) {
      $0.error = nil
      $0.$session.withLock { $0.phase = .deactivating }
    }
    await store.receive(\.deactivationResponse) {
      $0.error = LicenseFeatureError(
        operation: .deactivation,
        cause: .connectionRequired
      )
      $0.$session.withLock { $0.phase = .idle }
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
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    ) {
      $0.refresh = {
        refreshStarted.continuation.yield()
        for await entitlement in refreshResponse.stream {
          return entitlement
        }
        throw CancellationError()
      }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    } withDependencies: {
      $0.continuousClock = clock
    }

    await store.send(.task) {
      $0.$session.withLock { $0.phase = .refreshing }
    }
    for await _ in refreshStarted.stream {
      break
    }

    #expect(store.state.access.permitsPaidUse)
    #expect(store.state.entitlement == entitlement)

    await store.send(.shutdown) {
      $0.$session.withLock { $0.phase = .idle }
    }
    refreshStarted.continuation.finish()
    refreshResponse.continuation.finish()
    await store.finish()
  }

  @Test
  func refreshFailureKeepsCachedEntitlement() async {
    let entitlement = paidEntitlement()
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    ) {
      $0.refresh = {
        throw LicenseClientError.connectionRequired
      }
    }
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    }

    await store.send(.refreshRequested(.automatic)) {
      $0.$session.withLock { $0.phase = .refreshing }
    }
    await store.receive(\.refreshResponse) {
      $0.$session.withLock { $0.phase = .idle }
    }

    #expect(store.state.access.permitsPaidUse)
    #expect(store.state.entitlement == entitlement)
  }

  @Test
  func signedTransferCreatesDatedNoticeAndActionsClearIt() async throws {
    let active = paidEntitlement()
    let transfer = LicenseEntitlement(
      licenseID: active.licenseID,
      deviceID: active.deviceID,
      status: .transferred,
      updatesThrough: nil,
      revision: 2,
      issuedAt: 1_787_270_400,
      revocationReason: nil,
      signedToken: "transfer-token"
    )
    let tombstoneCount = LockIsolated(0)
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: active, hasLicenseKey: true),
      onTombstone: { tombstoneCount.withValue { $0 += 1 } },
      configure: { $0.refresh = { transfer } }
    )
    try await runtime.refreshAndApply()
    let store = TestStore(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    }

    #expect(store.state.notice?.message == "This license moved to another Mac on 2026-08-21.")
    #expect(tombstoneCount.value == 1)

    await store.send(.noticeDifferentKeyButtonTapped) {
      $0.$session.withLock {
        $0.noticeAcknowledgement = LicenseNoticeAcknowledgement(
          licenseID: transfer.licenseID,
          revision: transfer.revision
        )
      }
    }
  }

  @Test
  func acknowledgedNoticeStaysHiddenAcrossRuntimeRestart() {
    let transfer = tombstone(revision: 2)
    let acknowledgement = LicenseNoticeAcknowledgement(
      licenseID: transfer.licenseID,
      revision: transfer.revision
    )
    let snapshot = LicenseClient.Snapshot(
      entitlement: transfer,
      hasLicenseKey: true,
      noticeAcknowledgement: acknowledgement
    )

    let first = LicenseFeature.State(runtime: runtime(snapshot: snapshot))
    let second = LicenseFeature.State(runtime: runtime(snapshot: snapshot))

    #expect(first.notice == nil)
    #expect(second.notice == nil)
  }

  @Test
  func newerTombstoneRevisionShowsNotice() {
    let transfer = tombstone(revision: 3)
    let snapshot = LicenseClient.Snapshot(
      entitlement: transfer,
      hasLicenseKey: true,
      noticeAcknowledgement: LicenseNoticeAcknowledgement(
        licenseID: transfer.licenseID,
        revision: 2
      )
    )

    let state = LicenseFeature.State(runtime: runtime(snapshot: snapshot))

    #expect(state.notice?.kind == .transferred)
  }

  @Test
  func updateRefreshReportsOnlyNewTombstoneTransition() async throws {
    let active = paidEntitlement()
    let transfer = tombstone(revision: 2)
    let tombstoneCount = LockIsolated(0)
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: active, hasLicenseKey: true),
      onTombstone: { tombstoneCount.withValue { $0 += 1 } },
      configure: { $0.refresh = { transfer } }
    )

    try await runtime.refreshAndApply()
    try await runtime.refreshAndApply()

    #expect(runtime.session.wrappedValue.entitlement == transfer)
    #expect(tombstoneCount.value == 1)
  }

  @Test
  func concurrentRefreshesShareOneRequest() async throws {
    let entitlement = paidEntitlement()
    let refreshStarted = AsyncStream.makeStream(of: Void.self)
    let refreshResponse = AsyncStream.makeStream(of: LicenseEntitlement.self)
    let refreshCount = LockIsolated(0)
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    ) {
      $0.refresh = {
        refreshCount.withValue { $0 += 1 }
        refreshStarted.continuation.yield()
        for await entitlement in refreshResponse.stream {
          return entitlement
        }
        throw CancellationError()
      }
    }

    let first = Task { try await runtime.refreshAndApply() }
    for await _ in refreshStarted.stream { break }
    let second = Task { try await runtime.refreshAndApply() }
    await Task.yield()
    refreshResponse.continuation.yield(entitlement)

    try await first.value
    try await second.value
    #expect(refreshCount.value == 1)
    refreshStarted.continuation.finish()
    refreshResponse.continuation.finish()
  }

  @Test
  func runtimeRejectsInactiveActivationWithoutReplacingTheSession() async {
    let active = paidEntitlement()
    let inactive = tombstone(revision: 2)
    let runtime = runtime(
      snapshot: LicenseClient.Snapshot(entitlement: active, hasLicenseKey: true)
    ) {
      $0.activate = { _ in inactive }
    }

    await #expect(throws: LicenseClientError.inactiveLicense) {
      try await runtime.activateAndApply("inactive-key")
    }
    #expect(runtime.session.wrappedValue.entitlement == active)
    #expect(runtime.session.wrappedValue.hasLicenseKey)
    #expect(runtime.session.wrappedValue.phase == .idle)
  }

  private func runtime(
    snapshot: LicenseClient.Snapshot = LicenseClient.Snapshot(
      entitlement: nil,
      hasLicenseKey: false
    ),
    configure: (inout LicenseClient) -> Void = { _ in }
  ) -> LicenseRuntime {
    runtime(snapshot: snapshot, onTombstone: {}, configure: configure)
  }

  private func runtime(
    snapshot: LicenseClient.Snapshot,
    onTombstone: @escaping @MainActor @Sendable () -> Void,
    configure: (inout LicenseClient) -> Void
  ) -> LicenseRuntime {
    var client = LicenseClient.testValue
    client.load = { snapshot }
    configure(&client)
    return LicenseRuntime(client: client, onTombstone: onTombstone)
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

  private func tombstone(revision: Int) -> LicenseEntitlement {
    LicenseEntitlement(
      licenseID: "00112233445566778899aabbccddeeff",
      deviceID: "device",
      status: .transferred,
      updatesThrough: nil,
      revision: revision,
      issuedAt: 1_787_270_400,
      revocationReason: nil,
      signedToken: "transfer-token-\(revision)"
    )
  }

  private func day(_ value: String) -> LicenseDay {
    guard let day = LicenseDay(value) else {
      preconditionFailure("Invalid test license day")
    }
    return day
  }
}
