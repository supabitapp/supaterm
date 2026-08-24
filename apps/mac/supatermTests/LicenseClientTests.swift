import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport

struct LicenseClientTests {
  @Test
  func licenseKeyNormalizesAndDerivesID() throws {
    let credential = try #require(LicenseCredential("  \(Self.oldKey.lowercased())\n"))

    #expect(credential.rawValue == Self.oldKey)
    #expect(credential.licenseID == "00112233445566778899aabbccddeeff")
  }

  @Test
  func deviceIDUsesNamespacedHardwareUUIDHash() throws {
    let device = try #require(
      LicenseDevice.current(
        hardwareUUID: "UUID",
        name: "Mac",
        appVersion: "1.0.0"
      )
    )

    #expect(device.id == "d4e13dd6b3924d067b426da2188a479efc54fbea932fa083c083ebc6dbd1de56")
  }

  @Test
  func refreshStoresSignedTombstone() async throws {
    let key = try #require(LicenseCredential(Self.oldKey))
    let active = entitlement(
      licenseID: key.licenseID,
      status: .active,
      revision: 1,
      token: "active-token"
    )
    let tombstone = entitlement(
      licenseID: key.licenseID,
      status: .revoked,
      revision: 2,
      token: "tombstone-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: key.rawValue, token: active.signedToken)
    )
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: unimplemented("activate"),
        deactivate: unimplemented("deactivate"),
        refresh: { _, _ in tombstone.signedToken }
      ),
      storage: storage(persisted),
      verifier: verifier([active.signedToken: active, tombstone.signedToken: tombstone])
    )

    let refreshed = try await client.refresh()

    #expect(refreshed == tombstone)
    #expect(persisted.value.token == tombstone.signedToken)
  }

  @Test
  func unsignedRefreshKeepsStoredEntitlement() async throws {
    let key = try #require(LicenseCredential(Self.oldKey))
    let active = entitlement(
      licenseID: key.licenseID,
      status: .active,
      revision: 1,
      token: "active-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: key.rawValue, token: active.signedToken)
    )
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: unimplemented("activate"),
        deactivate: unimplemented("deactivate"),
        refresh: { _, _ in "unsigned-token" }
      ),
      storage: storage(persisted),
      verifier: verifier([active.signedToken: active])
    )

    await #expect(throws: LicenseClientError.invalidEntitlement) {
      try await client.refresh()
    }
    #expect(persisted.value.token == active.signedToken)
  }

  @Test
  func switchingKeysActivatesNewBeforeDeactivatingOld() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let oldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 1,
      token: "old-token"
    )
    let newEntitlement = entitlement(
      licenseID: newCredential.licenseID,
      status: .active,
      revision: 1,
      token: "new-token"
    )
    let oldTombstone = entitlement(
      licenseID: oldCredential.licenseID,
      status: .deactivated,
      revision: 2,
      token: "old-tombstone"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: oldEntitlement.signedToken)
    )
    let requests = LockIsolated<[String]>([])
    let cleanupFinished = AsyncStream.makeStream(of: Void.self)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { key, _ in
          requests.withValue { $0.append("activate:\(key)") }
          return newEntitlement.signedToken
        },
        deactivate: { key, _ in
          requests.withValue { $0.append("deactivate:\(key)") }
          cleanupFinished.continuation.yield()
          return oldTombstone.signedToken
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([
        oldEntitlement.signedToken: oldEntitlement,
        newEntitlement.signedToken: newEntitlement,
        oldTombstone.signedToken: oldTombstone,
      ])
    )

    let activated = try await client.activate(newCredential.rawValue)
    for await _ in cleanupFinished.stream { break }

    #expect(activated == newEntitlement)
    #expect(persisted.value.key == newCredential.rawValue)
    #expect(persisted.value.token == newEntitlement.signedToken)
    #expect(
      requests.value == [
        "activate:\(newCredential.rawValue)",
        "deactivate:\(oldCredential.rawValue)",
      ])
    cleanupFinished.continuation.finish()
  }

  @Test
  func switchingKeysDeactivatesOldLicenseWhenItsTokenIsMissing() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let newEntitlement = entitlement(
      licenseID: newCredential.licenseID,
      status: .active,
      revision: 1,
      token: "new-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: nil)
    )
    let deactivatedKeys = LockIsolated<[String]>([])
    let cleanupFinished = AsyncStream.makeStream(of: Void.self)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { _, _ in newEntitlement.signedToken },
        deactivate: { key, _ in
          deactivatedKeys.withValue { $0.append(key) }
          cleanupFinished.continuation.yield()
          return ""
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([newEntitlement.signedToken: newEntitlement])
    )

    _ = try await client.activate(newCredential.rawValue)
    for await _ in cleanupFinished.stream { break }

    #expect(deactivatedKeys.value == [oldCredential.rawValue])
    cleanupFinished.continuation.finish()
  }

  @Test
  func inactiveKeySwitchKeepsOldLicense() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let oldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 1,
      token: "old-token"
    )
    let newTombstone = entitlement(
      licenseID: newCredential.licenseID,
      status: .revoked,
      revision: 2,
      token: "new-tombstone"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: oldEntitlement.signedToken)
    )
    let deactivationCount = LockIsolated(0)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { _, _ in newTombstone.signedToken },
        deactivate: { _, _ in
          deactivationCount.withValue { $0 += 1 }
          return ""
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([
        oldEntitlement.signedToken: oldEntitlement,
        newTombstone.signedToken: newTombstone,
      ])
    )

    await #expect(throws: LicenseClientError.inactiveLicense) {
      try await client.activate(newCredential.rawValue)
    }
    #expect(
      persisted.value
        == PersistedLicense(
          key: oldCredential.rawValue,
          token: oldEntitlement.signedToken
        ))
    #expect(deactivationCount.value == 0)
  }

  @Test
  func keySwitchDoesNotWaitForOldLicenseCleanup() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let oldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 1,
      token: "old-token"
    )
    let newEntitlement = entitlement(
      licenseID: newCredential.licenseID,
      status: .active,
      revision: 1,
      token: "new-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: oldEntitlement.signedToken)
    )
    let cleanupStarted = AsyncStream.makeStream(of: Void.self)
    let allowCleanup = AsyncStream.makeStream(of: Void.self)
    let cleanupFinished = AsyncStream.makeStream(of: Void.self)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { _, _ in newEntitlement.signedToken },
        deactivate: { _, _ in
          cleanupStarted.continuation.yield()
          for await _ in allowCleanup.stream { break }
          cleanupFinished.continuation.yield()
          return ""
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([
        oldEntitlement.signedToken: oldEntitlement,
        newEntitlement.signedToken: newEntitlement,
      ])
    )

    let activated = try await client.activate(newCredential.rawValue)
    for await _ in cleanupStarted.stream { break }

    #expect(activated == newEntitlement)
    #expect(
      persisted.value
        == PersistedLicense(
          key: newCredential.rawValue,
          token: newEntitlement.signedToken
        ))

    allowCleanup.continuation.yield()
    for await _ in cleanupFinished.stream { break }
    cleanupStarted.continuation.finish()
    allowCleanup.continuation.finish()
    cleanupFinished.continuation.finish()
  }

  @Test
  func laterKeySwitchWaitsForPendingCleanup() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let oldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 1,
      token: "old-token"
    )
    let newEntitlement = entitlement(
      licenseID: newCredential.licenseID,
      status: .active,
      revision: 1,
      token: "new-token"
    )
    let reactivatedOldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 3,
      token: "reactivated-old-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: oldEntitlement.signedToken)
    )
    let sequence = LockIsolated<[String]>([])
    let cleanupStarted = AsyncStream.makeStream(of: Void.self)
    let cleanupRelease = AsyncStream.makeStream(of: Void.self)
    let secondAttempted = AsyncStream.makeStream(of: Void.self)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { key, _ in
          sequence.withValue { $0.append("activate:\(key)") }
          return key == newCredential.rawValue
            ? newEntitlement.signedToken : reactivatedOldEntitlement.signedToken
        },
        deactivate: { _, _ in
          sequence.withValue { $0.append("cleanup-started") }
          cleanupStarted.continuation.yield()
          for await _ in cleanupRelease.stream { break }
          sequence.withValue { $0.append("cleanup-finished") }
          return ""
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([
        oldEntitlement.signedToken: oldEntitlement,
        newEntitlement.signedToken: newEntitlement,
        reactivatedOldEntitlement.signedToken: reactivatedOldEntitlement,
      ])
    )

    _ = try await client.activate(newCredential.rawValue)
    for await _ in cleanupStarted.stream { break }
    let second = Task {
      secondAttempted.continuation.yield()
      return try await client.activate(oldCredential.rawValue)
    }
    for await _ in secondAttempted.stream { break }
    await Task.yield()
    cleanupRelease.continuation.yield()
    _ = try await second.value

    #expect(
      Array(sequence.value.prefix(4)) == [
        "activate:\(newCredential.rawValue)",
        "cleanup-started",
        "cleanup-finished",
        "activate:\(oldCredential.rawValue)",
      ]
    )
    cleanupRelease.continuation.yield()
    cleanupStarted.continuation.finish()
    cleanupRelease.continuation.finish()
    secondAttempted.continuation.finish()
  }

  @Test
  func localInstancesUseDistinctKeychainServices() {
    let production = LicenseKeychain.identifier(instanceName: nil)

    #expect(LicenseKeychain.identifier(instanceName: "default") == production)
    #expect(LicenseKeychain.identifier(instanceName: "development") != production)
    #expect(
      LicenseKeychain.identifier(instanceName: "development")
        == "app.supabit.supaterm.license.875b9380866e9d56"
    )
    #expect(
      LicenseKeychain.identifier(instanceName: "development")
        != LicenseKeychain.identifier(instanceName: "release-test")
    )
  }

  #if DEBUG
    @Test
    func debugClientActivatesWithoutTheLicenseService() async throws {
      let client = LicenseClient.debugValue

      let entitlement = try await client.activate(Self.oldKey)

      #expect(entitlement.status == .active)
      #expect(entitlement.signedToken == "debug")
    }
  #endif

  @Test
  func failedKeySwitchKeepsOldLicense() async throws {
    let oldCredential = try #require(LicenseCredential(Self.oldKey))
    let newCredential = try #require(LicenseCredential(Self.newKey))
    let oldEntitlement = entitlement(
      licenseID: oldCredential.licenseID,
      status: .active,
      revision: 1,
      token: "old-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: oldCredential.rawValue, token: oldEntitlement.signedToken)
    )
    let deactivationCount = LockIsolated(0)
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: { _, _ in throw LicenseClientError.connectionRequired },
        deactivate: { _, _ in
          deactivationCount.withValue { $0 += 1 }
          return ""
        },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([oldEntitlement.signedToken: oldEntitlement])
    )

    await #expect(throws: LicenseClientError.connectionRequired) {
      try await client.activate(newCredential.rawValue)
    }
    #expect(
      persisted.value
        == PersistedLicense(
          key: oldCredential.rawValue,
          token: oldEntitlement.signedToken
        ))
    #expect(deactivationCount.value == 0)
  }

  @Test
  func offlineDeactivationKeepsLocalLicense() async throws {
    let credential = try #require(LicenseCredential(Self.oldKey))
    let active = entitlement(
      licenseID: credential.licenseID,
      status: .active,
      revision: 1,
      token: "active-token"
    )
    let persisted = LockIsolated(
      PersistedLicense(key: credential.rawValue, token: active.signedToken)
    )
    let client = LicenseClient.live(
      device: Self.device,
      service: LicenseServiceClient(
        activate: unimplemented("activate"),
        deactivate: { _, _ in throw LicenseClientError.connectionRequired },
        refresh: unimplemented("refresh")
      ),
      storage: storage(persisted),
      verifier: verifier([active.signedToken: active])
    )

    await #expect(throws: LicenseClientError.connectionRequired) {
      try await client.deactivate()
    }
    #expect(
      persisted.value
        == PersistedLicense(
          key: credential.rawValue,
          token: active.signedToken
        ))
  }

  private static let oldKey =
    "SUPATERM-AAISEM2EKVTHPCEZVK54ZXPO74-3PKIJUFYD2AX67Q72CTXRZUEVA"
  private static let newKey =
    "SUPATERM-DCHPCZTQ2N2Q4BKPG2IEGPNABA-XIDDIV3XKEIWFTXT4HJLFMPIMI"
  private static let device = LicenseDevice(
    id: "device",
    name: "Mac",
    appVersion: "1.0.0"
  )

  private func entitlement(
    licenseID: String,
    status: LicenseEntitlement.Status,
    revision: Int,
    token: String
  ) -> LicenseEntitlement {
    LicenseEntitlement(
      licenseID: licenseID,
      deviceID: Self.device.id,
      status: status,
      updatesThrough: status == .active ? LicenseDay("2099-01-01") : nil,
      revision: revision,
      issuedAt: Int64(revision),
      revocationReason: status == .revoked ? "refund" : nil,
      signedToken: token
    )
  }

  private func storage(
    _ persisted: LockIsolated<PersistedLicense>
  ) -> LicenseStorageClient {
    LicenseStorageClient(
      delete: {
        persisted.withValue { $0 = PersistedLicense(key: nil, token: nil) }
      },
      loadKey: { persisted.value.key },
      loadToken: { persisted.value.token },
      save: { key, token in
        persisted.withValue { $0 = PersistedLicense(key: key, token: token) }
      }
    )
  }

  private func verifier(
    _ entitlements: [String: LicenseEntitlement]
  ) -> LicenseEntitlementVerifier {
    LicenseEntitlementVerifier(
      decode: { token, deviceID, licenseID in
        guard
          let entitlement = entitlements[token],
          entitlement.deviceID == deviceID,
          entitlement.licenseID == licenseID
        else { return nil }
        return entitlement
      }
    )
  }
}

private struct PersistedLicense: Equatable, Sendable {
  var key: String?
  var token: String?
}
