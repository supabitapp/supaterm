import Testing

@testable import supaterm

struct TerminalSidebarUpdatePresentationTests {
  @Test
  func enteringNonIdlePhaseAutoExpands() {
    #expect(
      TerminalSidebarUpdatePresentation.shouldAutoExpand(
        from: .idle,
        to: .checking
      )
    )
  }

  @Test
  func enteringErrorAutoExpandsEvenFromAnotherVisiblePhase() {
    #expect(
      TerminalSidebarUpdatePresentation.shouldAutoExpand(
        from: .downloading(.init(expectedLength: 400, progress: 100)),
        to: .error(.init(message: "Network error"))
      )
    )
  }

  @Test
  func visiblePhaseTransitionDoesNotReexpandByDefault() {
    #expect(
      !TerminalSidebarUpdatePresentation.shouldAutoExpand(
        from: .checking,
        to: .updateAvailable(.init(contentLength: nil, releaseDate: nil, version: "1.2.3"))
      )
    )
  }

  @Test
  func idleTargetNeverAutoExpands() {
    #expect(
      !TerminalSidebarUpdatePresentation.shouldAutoExpand(
        from: .checking,
        to: .idle
      )
    )
  }
}
