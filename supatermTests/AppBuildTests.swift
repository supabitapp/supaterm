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
}
