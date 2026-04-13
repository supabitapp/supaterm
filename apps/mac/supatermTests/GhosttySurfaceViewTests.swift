import AppKit
import GhosttyKit
import Testing

@testable import supaterm

struct GhosttySurfaceViewTests {
  @Test
  func legacyScrollerFlashRequiresLegacyStyleAndMotionAllowance() {
    #expect(
      GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: true
      )
    )
    #expect(
      !GhosttySurfaceScrollView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: true
      )
    )
  }

  @Test
  func reportedSurfaceSizeUsesScrollContentWidth() {
    #expect(
      GhosttySurfaceScrollView.reportedSurfaceSize(
        scrollContentSize: CGSize(width: 799, height: 600),
        surfaceFrameSize: CGSize(width: 816, height: 600)
      ) == CGSize(width: 799, height: 600)
    )
  }

  @Test
  @MainActor
  func wrapperSafeAreaInsetsAreZero() {
    initializeGhosttyForTests()

    let surfaceView = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let wrapper = GhosttySurfaceScrollView(surfaceView: surfaceView)

    #expect(wrapper.safeAreaInsets.top == 0)
    #expect(wrapper.safeAreaInsets.left == 0)
    #expect(wrapper.safeAreaInsets.bottom == 0)
    #expect(wrapper.safeAreaInsets.right == 0)
  }
}
