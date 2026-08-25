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
      license: updateLicense(entitlement),
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
      license: updateLicense(entitlement),
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
      license: updateLicense(entitlement),
      currentVersion: "1"
    )

    let result = driver.bestValidUpdate(
      in: [try release(version: "2", day: "2026-08-21")]
    )

    #expect(result == .install(URL(string: "https://supaterm.com/download/2.zip")!))
  }

  @Test
  func unownedHeadRequestsRenewalInsteadOfSelectingAnOlderOwnedRelease() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: updateLicense(entitlement),
      currentVersion: "1"
    )

    let result = driver.bestValidUpdate(
      in: [
        try release(version: "3", day: "2026-08-22"),
        try release(version: "2", day: "2026-08-21"),
      ]
    )

    #expect(
      result
        == .renew(
          UpdatePhase.OwnershipEnded(
            licenseID: "00112233445566778899aabbccddeeff",
            updatesThrough: try #require(LicenseDay("2026-08-21")),
            version: "3"
          )
        )
    )
  }

  @Test
  func expiredTipIsNotInstallable() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: updateLicense(entitlement),
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
      license: updateLicense(entitlement),
      currentVersion: "1"
    )
    let releases = [
      try release(version: "3", day: "2026-08-22"),
      try release(version: "2", day: "2026-08-21"),
    ]

    #expect(
      driver.bestValidUpdate(in: releases)
        == .renew(
          UpdatePhase.OwnershipEnded(
            licenseID: "00112233445566778899aabbccddeeff",
            updatesThrough: try #require(LicenseDay("2026-08-21")),
            version: "3"
          )
        )
    )

    entitlement.withLock {
      $0 = self.licenseEntitlement(updatesThrough: "2026-08-22")
    }

    #expect(
      driver.bestValidUpdate(in: releases)
        == .install(URL(string: "https://supaterm.com/download/3.zip")!)
    )
  }

  @Test
  func ownedDownloadUsesTheNewestStableRelease() throws {
    let entitlement = Shared<LicenseEntitlement?>(value: nil)
    let driver = UpdateDriver(
      hostBundle: .main,
      license: updateLicense(entitlement)
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
  func ownershipEndedOffersTheLatestIncludedReleaseEvenWhenItIsOlder() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let releases = [
      try release(version: "6", day: "2026-08-22"),
      try release(version: "2", day: "2026-08-21"),
    ]
    let driver = UpdateDriver(
      hostBundle: .main,
      license: updateLicense(entitlement),
      currentVersion: "3"
    )

    #expect(
      driver.ownershipEnded(in: releases, releaseURL: { $0 })
        == UpdatePhase.OwnershipEnded(
          licenseID: "00112233445566778899aabbccddeeff",
          latestIncludedReleaseURL: URL(string: "https://supaterm.com/download/2.zip"),
          updatesThrough: try #require(LicenseDay("2026-08-21")),
          version: "6"
        )
    )
  }

  @Test
  func windowlessOwnershipEndedUsesSharedActionsAndOpensLatestIncludedRelease() throws {
    let downloadURL = try #require(URL(string: "https://supaterm.com/download/2.zip"))
    var presentedPhase: UpdatePhase?
    var presentedActions: [UpdateActionPresentation] = []
    var openedURL: URL?
    var acknowledgementCount = 0
    let driver = UpdateDriver(
      hostBundle: .main,
      license: .unlicensed,
      currentVersion: "1",
      openURL: { openedURL = $0 },
      presentOwnershipEnded: { phase, actions in
        presentedPhase = phase
        presentedActions = actions
        return .downloadLatestIncludedRelease
      }
    )
    let ownership = UpdatePhase.OwnershipEnded(
      licenseID: "00112233445566778899aabbccddeeff",
      latestIncludedReleaseURL: downloadURL,
      updatesThrough: try #require(LicenseDay("2026-08-21")),
      version: "6"
    )

    driver.showStandardOwnershipEnded(ownership) {
      acknowledgementCount += 1
    }

    #expect(presentedPhase == .ownershipEnded(ownership))
    #expect(
      presentedActions.map(\.title)
        == ["Download Your Latest Release", "Not Now"]
    )
    #expect(openedURL == downloadURL)
    #expect(acknowledgementCount == 1)
  }

  @Test
  func ownedReleaseOlderThanTheInstalledBuildIsNotSelected() throws {
    let entitlement = Shared<LicenseEntitlement?>(
      value: licenseEntitlement(updatesThrough: "2026-08-21")
    )
    let driver = UpdateDriver(
      hostBundle: .main,
      license: updateLicense(entitlement),
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
      license: updateLicense(entitlement),
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
      license: updateLicense(entitlement),
      currentVersion: "1"
    )
    driver.updateChannel = .tip

    #expect(
      driver.bestValidUpdate(
        in: [try release(version: "3000001", day: "2026-08-21", channel: "tip")]
      ) == .install(URL(string: "https://supaterm.com/download/3000001.zip")!)
    )
  }

  @Test
  func unownedHeadCreatesRenewalNotice() throws {
    let entitlement = licenseEntitlement(updatesThrough: "2026-08-21")
    let policy = UpdateOwnershipPolicy(
      currentVersion: "1",
      licenseAccess: LicenseAccess(
        entitlement: entitlement,
        releaseDay: try #require(LicenseDay("2026-08-22"))
      ),
      updateChannel: .stable
    )

    let result = policy.decision(
      in: [try release(version: "26.4.0", day: "2026-08-22")]
    )

    #expect(
      result
        == UpdateOwnershipDecision.renew(
          UpdatePhase.OwnershipEnded(
            licenseID: "00112233445566778899aabbccddeeff",
            updatesThrough: try #require(LicenseDay("2026-08-21")),
            version: "26.4.0"
          )
        )
    )
  }

  @Test
  func sparkleCallsTheAppcastDelegateSeams() {
    let driver = UpdateDriver(hostBundle: .main, license: .unlicensed)

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
        access: { .free },
        refresh: {
          refreshes.withLock { $0 += 1 }
        }
      )
    )

    await driver.refreshLicenseBeforeUpdateCheck()

    #expect(refreshes.wrappedValue == 1)
  }

  private func updateLicense(
    _ entitlement: Shared<LicenseEntitlement?>
  ) -> UpdateLicenseClient {
    UpdateLicenseClient(
      access: {
        LicenseAccess(
          entitlement: entitlement.wrappedValue,
          releaseDay: AppBuild.releaseDay
        )
      },
      refresh: {}
    )
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
