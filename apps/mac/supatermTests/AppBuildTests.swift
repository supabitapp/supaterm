import Foundation
import Testing

@testable import SupatermSupport

struct AppBuildTests {
  @Test
  func developmentBuildMatchesBuildConfiguration() {
    #if DEBUG
      #expect(AppBuild.isDevelopmentBuild)
    #else
      #expect(
        AppBuild.isDevelopmentBuild
          == AppBuild.isEnabledFlag(
            Bundle.main.object(forInfoDictionaryKey: "SupatermDevelopmentBuild")
          )
      )
    #endif
  }

  @Test
  func stubUpdateChecksMatchBuildConfiguration() {
    #if DEBUG
      #expect(AppBuild.usesStubServices)
      #expect(AppBuild.usesStubUpdateChecks)
    #else
      #expect(!AppBuild.usesStubServices)
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

    #expect(AppBuild.parsedReleaseDay(stamped.rawValue) == stamped)
  }

  @Test
  func releaseDayRejectsAnAbsentStamp() {
    #expect(AppBuild.parsedReleaseDay(nil) == nil)
  }

  @Test
  func enabledFlagParsesTrueValues() {
    #expect(AppBuild.isEnabledFlag(true))
    #expect(AppBuild.isEnabledFlag("YES"))
    #expect(AppBuild.isEnabledFlag("true"))
    #expect(AppBuild.isEnabledFlag(" 1 "))
    #expect(AppBuild.isEnabledFlag(NSNumber(value: true)))
  }

  @Test
  func enabledFlagParsesFalseValues() {
    #expect(!AppBuild.isEnabledFlag(nil))
    #expect(!AppBuild.isEnabledFlag(false))
    #expect(!AppBuild.isEnabledFlag("NO"))
    #expect(!AppBuild.isEnabledFlag("0"))
    #expect(!AppBuild.isEnabledFlag(NSNumber(value: false)))
  }
}
