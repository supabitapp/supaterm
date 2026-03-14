import Foundation
import Testing

@testable import supaterm

struct AppBuildTests {
  @Test
  func backgroundUpdateCheckOnLaunchIsAlwaysEnabled() {
    #expect(AppBuild.allowsBackgroundUpdateCheckOnLaunch)
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
