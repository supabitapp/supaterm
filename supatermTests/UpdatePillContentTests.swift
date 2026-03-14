import Testing

@testable import supaterm

struct UpdatePillContentTests {
  @Test
  func developmentBuildShowsFallbackPillWhenIdle() {
    let pill = UpdatePillContent(phase: .idle, isDevelopmentBuild: true)

    #expect(pill?.allowsPopover == false)
    #expect(pill?.badge == .icon(name: "hammer", spins: false))
    #expect(pill?.helpText == AppBuild.developmentBuildMessage)
    #expect(pill?.text == AppBuild.developmentPillText)
    #expect(pill?.tone == .accent)
  }

  @Test
  func idlePhaseHasNoPillInReleaseBuilds() {
    #expect(UpdatePillContent(phase: .idle, isDevelopmentBuild: false) == nil)
  }

  @Test
  func updatePhasesOverrideDevelopmentBuildFallback() {
    let pill = UpdatePillContent(phase: .checking, isDevelopmentBuild: true)

    #expect(pill?.allowsPopover == false)
    #expect(pill?.badge == .icon(name: "arrow.triangle.2.circlepath", spins: true))
    #expect(pill?.text == "Checking for Updates…")
  }
}
