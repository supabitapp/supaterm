import AppKit
import Testing

@testable import supaterm

struct GhosttySurfaceViewTests {
  @Test
  func legacyScrollerFlashRequiresLegacyStyleAndMotionAllowance() {
    #expect(
      GhosttySurfaceView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: false
      )
    )
    #expect(
      !GhosttySurfaceView.shouldFlashLegacyScrollers(
        scrollerStyle: .legacy,
        reduceMotion: true
      )
    )
    #expect(
      !GhosttySurfaceView.shouldFlashLegacyScrollers(
        scrollerStyle: .overlay,
        reduceMotion: true
      )
    )
  }
}
