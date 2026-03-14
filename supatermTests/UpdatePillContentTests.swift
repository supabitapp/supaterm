import Testing

@testable import supaterm

struct UpdatePillContentTests {
  @Test
  func developmentBuildShowsCircleWhenIdleAndNotHovered() {
    let pill = UpdatePillContent(
      phase: .idle,
      isDevelopmentBuild: true,
      isDevelopmentIndicatorHovering: false
    )

    #expect(pill?.allowsPopover == false)
    #expect(pill?.badge == nil)
    #expect(pill?.helpText == AppBuild.developmentBuildMessage)
    #expect(pill?.maxText == AppBuild.developmentBuildMessage)
    #expect(pill?.style == .circle)
    #expect(pill?.text == "")
    #expect(pill?.tone == .accent)
  }

  @Test
  func idlePhaseHasNoPillInReleaseBuilds() {
    #expect(
      UpdatePillContent(
        phase: .idle,
        isDevelopmentBuild: false,
        isDevelopmentIndicatorHovering: false
      ) == nil
    )
  }

  @Test
  func developmentBuildShowsCapsuleWhenHovered() {
    let pill = UpdatePillContent(
      phase: .idle,
      isDevelopmentBuild: true,
      isDevelopmentIndicatorHovering: true
    )

    #expect(pill?.style == .capsule)
    #expect(pill?.text == AppBuild.developmentBuildMessage)
  }

  @Test
  func updatePhasesOverrideDevelopmentBuildFallback() {
    let pill = UpdatePillContent(
      phase: .checking,
      isDevelopmentBuild: true,
      isDevelopmentIndicatorHovering: true
    )

    #expect(pill?.allowsPopover == false)
    #expect(pill?.badge == .icon(name: "arrow.triangle.2.circlepath", spins: true))
    #expect(pill?.style == .circle)
    #expect(pill?.text == "")
  }

  @Test
  func noUpdatesAvailableDoesNotShowAPill() {
    #expect(
      UpdatePillContent(
        phase: .notFound,
        isDevelopmentBuild: true,
        isDevelopmentIndicatorHovering: false
      ) == nil
    )
  }
}
