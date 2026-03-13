import Testing

@testable import supaterm

struct AppBuildTests {
  @Test
  func developmentFlagParsesTrueValues() {
    #expect(AppBuild.isDevelopmentFlag(true))
    #expect(AppBuild.isDevelopmentFlag("YES"))
    #expect(AppBuild.isDevelopmentFlag("true"))
    #expect(AppBuild.isDevelopmentFlag(" 1 "))
  }

  @Test
  func developmentFlagParsesFalseValues() {
    #expect(!AppBuild.isDevelopmentFlag(nil))
    #expect(!AppBuild.isDevelopmentFlag(false))
    #expect(!AppBuild.isDevelopmentFlag("NO"))
    #expect(!AppBuild.isDevelopmentFlag("0"))
  }

  @Test
  func backgroundUpdateCheckOnLaunchIsEnabledForAllBuilds() {
    #expect(AppBuild.allowsBackgroundUpdateCheckOnLaunch(isDevelopment: true))
    #expect(AppBuild.allowsBackgroundUpdateCheckOnLaunch(isDevelopment: false))
  }
}
