import Foundation
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport

struct LicenseAccessTests {
  @Test
  func earlierDaySortsBeforeLaterDay() throws {
    let earlier = try #require(LicenseDay("2026-12-31"))
    let later = try #require(LicenseDay("2027-01-01"))

    #expect(earlier < later)
  }

  @Test
  func todayUsesUTCCalendarDay() throws {
    let date = Date(timeIntervalSince1970: 86_399)
    let expected = try day("1970-01-01")

    #expect(LicenseDay.today(at: date) == expected)
  }

  @Test(arguments: ["2027-2-01", "2027-02-29", "2027-13-01"])
  func invalidDayIsRejected(value: String) {
    #expect(LicenseDay(value) == nil)
  }

  @Test
  func noEntitlementUsesFreeAccess() throws {
    #expect(LicenseAccess(entitlement: nil, releaseDay: try day("2027-01-01")) == .free)
  }

  @Test
  func tombstoneUsesFreeAccess() throws {
    let entitlement = LicenseEntitlement(
      licenseID: "license",
      deviceID: "device",
      status: .revoked,
      updatesThrough: nil,
      revision: 2,
      issuedAt: 1,
      revocationReason: nil,
      signedToken: "signed-token"
    )

    #expect(
      LicenseAccess(entitlement: entitlement, releaseDay: try day("2027-01-01")) == .free
    )
  }

  @Test
  func releaseBeforeUpdateEndUsesPaidAccess() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2027-01-02"))
    let ownership = LicenseOwnership(licenseID: "license", updatesThrough: try day("2027-01-02"))

    #expect(
      LicenseAccess(entitlement: entitlement, releaseDay: try day("2027-01-01"))
        == .paid(ownership)
    )
  }

  @Test
  func releaseOnUpdateEndUsesPaidAccess() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2027-01-01"))
    let ownership = LicenseOwnership(licenseID: "license", updatesThrough: try day("2027-01-01"))

    #expect(
      LicenseAccess(entitlement: entitlement, releaseDay: try day("2027-01-01"))
        == .paid(ownership)
    )
  }

  @Test
  func releaseAfterUpdateEndUsesExpiredAccess() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2026-12-31"))
    let ownership = LicenseOwnership(licenseID: "license", updatesThrough: try day("2026-12-31"))

    #expect(
      LicenseAccess(entitlement: entitlement, releaseDay: try day("2027-01-01"))
        == .expired(ownership)
    )
  }

  private func day(_ value: String) throws -> LicenseDay {
    try #require(LicenseDay(value))
  }

  private func activeEntitlement(updatesThrough: LicenseDay) -> LicenseEntitlement {
    LicenseEntitlement(
      licenseID: "license",
      deviceID: "device",
      status: .active,
      updatesThrough: updatesThrough,
      revision: 1,
      issuedAt: 1,
      revocationReason: nil,
      signedToken: "signed-token"
    )
  }
}
