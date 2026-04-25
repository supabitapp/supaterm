import SwiftUI
import Testing

@testable import supaterm

struct TerminalMotionTests {
  @Test
  func motionAllowanceFollowsReduceMotionSetting() {
    #expect(TerminalMotion.allowsMotion(reduceMotion: false))
    #expect(!TerminalMotion.allowsMotion(reduceMotion: true))
  }

  @Test
  func animationIsRemovedWhenReduceMotionIsEnabled() {
    #expect(TerminalMotion.animation(.easeInOut(duration: 0.2), reduceMotion: false) != nil)
    #expect(TerminalMotion.animation(.easeInOut(duration: 0.2), reduceMotion: true) == nil)
  }
}
