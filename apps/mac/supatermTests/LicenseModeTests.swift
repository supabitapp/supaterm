import Foundation
import SupatermSupport
import Testing

struct LicenseModeTests {
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
  func noEntitlementUsesFreeMode() throws {
    #expect(LicenseMode(entitlement: nil, releaseDay: try day("2027-01-01")) == .free)
  }

  @Test
  func tombstoneUsesFreeMode() throws {
    let entitlement = LicenseEntitlement(
      licenseID: "license",
      deviceID: "device",
      status: .revoked,
      updatesThrough: nil,
      revision: 2,
      issuedAt: 1
    )

    #expect(
      LicenseMode(entitlement: entitlement, releaseDay: try day("2027-01-01")) == .free
    )
  }

  @Test
  func releaseBeforeUpdateEndUsesPaidMode() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2027-01-02"))

    #expect(
      LicenseMode(entitlement: entitlement, releaseDay: try day("2027-01-01")) == .paid
    )
  }

  @Test
  func releaseOnUpdateEndUsesPaidMode() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2027-01-01"))

    #expect(
      LicenseMode(entitlement: entitlement, releaseDay: try day("2027-01-01")) == .paid
    )
  }

  @Test
  func releaseAfterUpdateEndUsesExpiredMode() throws {
    let entitlement = activeEntitlement(updatesThrough: try day("2026-12-31"))

    #expect(
      LicenseMode(entitlement: entitlement, releaseDay: try day("2027-01-01"))
        == .expiredOnNewerRelease
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
      issuedAt: 1
    )
  }
}
