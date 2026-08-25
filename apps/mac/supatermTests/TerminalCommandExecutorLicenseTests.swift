import Clocks
import ComposableArchitecture
import Sharing
import SupatermCLIShared
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorLicenseTests {
  @Test
  func activationUsesLicenseFeatureAndReturnsPaidStatus() async throws {
    let clock = TestClock()
    let entitlement = licenseEntitlement(updatesThrough: "2099-01-01")
    let activatedKey = LockIsolated<String?>(nil)
    let fixture = licenseExecutor(
      licenseClient: LicenseClient(
        activate: { key in
          activatedKey.withValue { $0 = key }
          return entitlement
        },
        deactivate: {},
        load: { LicenseClient.Snapshot(entitlement: nil, hasLicenseKey: false) },
        refresh: { entitlement }
      ),
      clock: clock
    )

    let result = try await fixture.executor.execute(.activate("  license-key\n"))

    #expect(activatedKey.value == "license-key")
    #expect(
      result
        == .status(
          SupatermLicenseStatusResult(
            mode: .paid,
            updatesThrough: "2099-01-01",
            deviceName: "Test Mac",
            openTabCount: 0
          )
        )
    )
    #expect(fixture.store.entitlement == entitlement)
    #expect(fixture.store.hasLicenseKey)
    await fixture.store.send(.shutdown).finish()
    withExtendedLifetime(fixture) {}
  }

  @Test
  func statusReflectsFreePaidAndExpiredModes() async throws {
    let free = licenseExecutor()
    let paid = licenseExecutor(
      snapshot: LicenseClient.Snapshot(
        entitlement: licenseEntitlement(updatesThrough: "2099-01-01"),
        hasLicenseKey: true
      )
    )
    let expired = licenseExecutor(
      snapshot: LicenseClient.Snapshot(
        entitlement: licenseEntitlement(updatesThrough: "2000-01-01"),
        hasLicenseKey: true
      )
    )

    #expect(try await licenseMode(from: free.executor) == .free)
    #expect(try await licenseMode(from: paid.executor) == .paid)
    #expect(try await licenseMode(from: expired.executor) == .expired)
    withExtendedLifetime(free) {}
    withExtendedLifetime(paid) {}
    withExtendedLifetime(expired) {}
  }

  @Test
  func offlineDeactivationReturnsAnErrorAndKeepsTheEntitlement() async throws {
    let entitlement = licenseEntitlement(updatesThrough: "2099-01-01")
    let snapshot = LicenseClient.Snapshot(entitlement: entitlement, hasLicenseKey: true)
    let fixture = licenseExecutor(
      snapshot: snapshot,
      licenseClient: LicenseClient(
        activate: { _ in entitlement },
        deactivate: { throw LicenseClientError.connectionRequired },
        load: { snapshot },
        refresh: { entitlement }
      )
    )

    let error = try await #require(throws: LicenseControlError.self) {
      try await fixture.executor.execute(.deactivate)
    }

    #expect(error.code == "connection_required")
    #expect(fixture.store.entitlement == entitlement)
    #expect(fixture.store.hasLicenseKey)
    withExtendedLifetime(fixture) {}
  }

  @Test
  func darkBuildRejectsPurchaseAndRenewalRoutes() async throws {
    let fixture = licenseExecutor()

    #expect(!AppBuild.licenseSalesEnabled)
    for request in [LicenseControlRequest.buy, .renew] {
      let error = try await #require(throws: LicenseControlError.self) {
        try await fixture.executor.execute(request)
      }
      #expect(error.code == "license_sales_unavailable")
    }
    withExtendedLifetime(fixture) {}
  }
}

private func licenseExecutor(
  snapshot: LicenseClient.Snapshot = LicenseClient.Snapshot(
    entitlement: nil,
    hasLicenseKey: false
  ),
  licenseClient: LicenseClient = .testValue,
  clock: TestClock<Duration> = TestClock()
) -> LicenseExecutorFixture {
  var licenseClient = licenseClient
  licenseClient.load = { snapshot }
  let runtime = LicenseRuntime(client: licenseClient)
  let store = Store(initialState: LicenseFeature.State(runtime: runtime)) {
    LicenseFeature(runtime: runtime)
  } withDependencies: {
    $0.continuousClock = clock
  }
  let registry = TerminalWindowRegistry.test(licenseStore: store)
  return LicenseExecutorFixture(
    store: store,
    registry: registry
  )
}

@MainActor
private struct LicenseExecutorFixture {
  let store: StoreOf<LicenseFeature>
  let registry: TerminalWindowRegistry

  var executor: TerminalCommandExecutor {
    TerminalCommandExecutor(registry: registry, licenseDeviceName: { "Test Mac" })
  }
}

private func licenseMode(
  from executor: TerminalCommandExecutor
) async throws -> SupatermLicenseMode {
  guard case .status(let status) = try await executor.execute(.status) else {
    Issue.record("Expected license status")
    return .free
  }
  return status.mode
}

private func licenseEntitlement(updatesThrough value: String) -> LicenseEntitlement {
  guard let day = LicenseDay(value) else {
    preconditionFailure("Invalid license day")
  }
  return LicenseEntitlement(
    licenseID: "00112233445566778899aabbccddeeff",
    deviceID: "device",
    status: .active,
    updatesThrough: day,
    revision: 1,
    issuedAt: 1,
    revocationReason: nil,
    signedToken: "signed-token"
  )
}
