import Foundation
import SupatermSupport
import Testing

struct AppBuildTests {
  @Test
  func developmentBuildMatchesBuildConfiguration() {
    #if DEBUG
      #expect(AppBuild.isDevelopmentBuild)
    #else
      #expect(
        AppBuild.isDevelopmentBuild
          == AppBuild.isDevelopmentFlag(
            Bundle.main.object(forInfoDictionaryKey: "SupatermDevelopmentBuild")
          )
      )
    #endif
  }

  @Test
  func stubUpdateChecksMatchBuildConfiguration() {
    #if DEBUG
      #expect(AppBuild.usesStubUpdateChecks)
    #else
      #expect(!AppBuild.usesStubUpdateChecks)
    #endif
  }

  @Test
  func releaseNotesMatchMarketingVersion() {
    #expect(
      SupatermExternalURL.releaseNotes.absoluteString
        == "https://github.com/supabitapp/supaterm/releases/tag/v\(AppBuild.version)"
    )
  }

  @Test
  func releaseDayReadsStampedValue() throws {
    let stamped = try #require(LicenseDay("2027-08-17"))
    let fallback = try #require(LicenseDay("2027-08-18"))

    #expect(AppBuild.releaseDay(infoValue: stamped.rawValue, fallback: fallback) == stamped)
  }

  @Test
  func releaseDayFallsBackWhenStampIsAbsent() throws {
    let fallback = try #require(LicenseDay("2027-08-18"))

    #expect(AppBuild.releaseDay(infoValue: nil, fallback: fallback) == fallback)
  }

  @Test
  func developmentFlagParsesTrueValues() {
    #expect(AppBuild.isDevelopmentFlag(true))
    #expect(AppBuild.isDevelopmentFlag("YES"))
    #expect(AppBuild.isDevelopmentFlag("true"))
    #expect(AppBuild.isDevelopmentFlag(" 1 "))
    #expect(AppBuild.isDevelopmentFlag(NSNumber(value: true)))
  }

  @Test
  func developmentFlagParsesFalseValues() {
    #expect(!AppBuild.isDevelopmentFlag(nil))
    #expect(!AppBuild.isDevelopmentFlag(false))
    #expect(!AppBuild.isDevelopmentFlag("NO"))
    #expect(!AppBuild.isDevelopmentFlag("0"))
    #expect(!AppBuild.isDevelopmentFlag(NSNumber(value: false)))
  }
}
