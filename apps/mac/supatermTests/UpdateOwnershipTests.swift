import Foundation
import Sharing
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport
@testable import SupatermUpdateFeature

@MainActor
struct UpdateOwnershipTests {
  @Test
  func nilEntitlementLeavesSelectionToSparkle() throws {
    let entitlement = Shared<LicenseEntitlement?>(value: nil)
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    #expect(driver.bestValidUpdate(in: [try release(version: "2", day: "2026-08-21")]) == .unfiltered)
  }

  @Test
  func tombstoneLeavesSelectionToSparkle() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(
        status: .revoked,
        updatesThrough: nil
      )
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    #expect(driver.bestValidUpdate(in: [try release(version: "2", day: "2026-08-21")]) == .unfiltered)
  }

  @Test
  func boundaryDayIsOwned() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    let result = driver.bestValidUpdate(
      in: [try release(version: "2", day: "2026-08-21")]
    )

    #expect(result == .release(URL(string: "https://supaterm.com/download/2.zip")!))
  }

  @Test
  func unownedHeadIsNotReplacedByAnOlderOwnedRelease() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    let result = driver.bestValidUpdate(
      in: [
        try release(version: "3", day: "2026-08-22"),
        try release(version: "2", day: "2026-08-21"),
      ]
    )

    #expect(result == .none)
  }

  @Test
  func expiredTipIsNotInstallable() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    let result = driver.bestValidUpdate(
      in: [try release(version: "3000001", day: "2026-08-22", channel: "tip")]
    )

    #expect(result == .none)
  }

  @Test
  func renewalLiftsTheFilterWithoutRestart() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )
    let releases = [
      try release(version: "3", day: "2026-08-22"),
      try release(version: "2", day: "2026-08-21"),
    ]

    #expect(
      driver.bestValidUpdate(in: releases)
        == .none
    )

    entitlement.withLock {
      $0 = self.licenseEntitlement(updatesThrough: "2026-08-22")
    }

    #expect(
      driver.bestValidUpdate(in: releases)
        == .release(URL(string: "https://supaterm.com/download/3.zip")!)
    )
  }

  @Test
  func ownedDownloadUsesTheNewestStableRelease() throws {
    let entitlement = Shared<LicenseEntitlement?>(value: nil)
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement)
    )
    let releases = [
      try release(version: "3000001", day: "2026-08-21", channel: "tip"),
      try release(version: "3", day: "2026-08-22"),
      try release(version: "2", day: "2026-08-21"),
    ]

    let result = driver.newestOwnedReleaseURL(
      in: releases,
      through: try #require(LicenseDay("2026-08-21"))
    )

    #expect(result == URL(string: "https://supaterm.com/download/2.zip"))
  }

  @Test
  func ownedReleaseOlderThanTheInstalledBuildIsNotSelected() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "3"
    )

    #expect(
      driver.bestValidUpdate(in: [try release(version: "2", day: "2026-08-21")])
        == .none
    )
  }

  @Test
  func stableChannelDoesNotSelectTip() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    #expect(
      driver.bestValidUpdate(
        in: [try release(version: "3000001", day: "2026-08-21", channel: "tip")]
      ) == .none
    )
  }

  @Test
  func tipChannelSelectsTip() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )
    driver.updateChannel = .tip

    #expect(
      driver.bestValidUpdate(
        in: [try release(version: "3000001", day: "2026-08-21", channel: "tip")]
      ) == .release(URL(string: "https://supaterm.com/download/3000001.zip")!)
    )
  }

  @Test
  func unownedHeadCreatesRenewalNotice() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(entitlement: entitlement),
      currentVersion: "1"
    )

    let result = driver.ownershipEnded(
      in: [try release(version: "26.4.0", day: "2026-08-22")]
    )

    #expect(
      result
        == UpdatePhase.OwnershipEnded(
          licenseID: "00112233445566778899aabbccddeeff",
          updatesThrough: try #require(LicenseDay("2026-08-21")),
          version: "26.4.0"
        )
    )
  }

  @Test
  func sparkleCallsTheAppcastDelegateSeams() {
    let driver = UpdateDriver(hostBundle: .main)

    #expect(driver.responds(to: NSSelectorFromString("bestValidUpdateInAppcast:forUpdater:")))
    #expect(driver.responds(to: NSSelectorFromString("updater:didFinishLoadingAppcast:")))
    #expect(driver.responds(to: NSSelectorFromString("updater:mayPerformUpdateCheck:error:")))
    #expect(
      driver.responds(
        to: NSSelectorFromString("updater:didFinishUpdateCycleForUpdateCheck:error:")
      )
    )
  }

  @Test
  func automaticCheckWaitsForRefreshAndSparkleCycle() {
    var preflight = UpdateCheckPreflight<Int>()

    #expect(preflight.request(1) == .startRefresh)
    #expect(preflight.request(1) == .deny)
    #expect(preflight.refreshDidFinish() == nil)
    #expect(preflight.cycleDidFinish(1) == 1)
    preflight.prepare(1)
    #expect(preflight.request(1) == .allow)
  }

  @Test
  func automaticCheckWaitsWhenTheSparkleCycleFinishesFirst() {
    var preflight = UpdateCheckPreflight<Int>()

    #expect(preflight.request(1) == .startRefresh)
    #expect(preflight.cycleDidFinish(1) == nil)
    #expect(preflight.refreshDidFinish() == 1)
    preflight.prepare(1)
    #expect(preflight.request(1) == .allow)
  }

  @Test
  func manualCheckCanArrivePrepared() {
    var preflight = UpdateCheckPreflight<Int>()

    preflight.prepare(1)

    #expect(preflight.request(1) == .allow)
    #expect(preflight.request(1) == .startRefresh)
  }

  @Test
  func preparingACheckRefreshesTheLicense() async {
    let refreshes = Shared(value: 0)
    let driver = UpdateDriver(
      hostBundle: .main,
      license: UpdateLicenseClient(
        entitlement: Shared(value: nil),
        refresh: {
          refreshes.withLock { $0 += 1 }
        }
      )
    )

    await driver.refreshLicenseBeforeUpdateCheck()

    #expect(refreshes.wrappedValue == 1)
  }

  private func licenseEntitlement(
    status: LicenseEntitlement.Status = .active,
    updatesThrough: String?
  ) -> LicenseEntitlement {
    LicenseEntitlement(
      licenseID: "00112233445566778899aabbccddeeff",
      deviceID: "device",
      status: status,
      updatesThrough: updatesThrough.flatMap { LicenseDay($0) },
      revision: 1,
      issuedAt: 1,
      revocationReason: nil,
      signedToken: "signed-token"
    )
  }

  private func release(
    version: String,
    day: String,
    channel: String? = nil
  ) throws -> UpdateRelease<URL> {
    guard let releaseDay = LicenseDay(day) else {
      throw UpdateOwnershipTestError.invalidDay
    }
    return UpdateRelease(
      value: URL(string: "https://supaterm.com/download/\(version).zip")!,
      version: version,
      releaseDay: releaseDay,
      channel: channel
    )
  }
}

private enum UpdateOwnershipTestError: Error {
  case invalidDay
}
