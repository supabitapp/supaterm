import Testing

@testable import supaterm

struct AppBuildTests {
  @Test
  func backgroundUpdateCheckOnLaunchIsAlwaysEnabled() {
    #expect(AppBuild.allowsBackgroundUpdateCheckOnLaunch)
  }
}
