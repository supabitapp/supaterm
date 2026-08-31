import AppKit
import QuartzCore
import Testing

@testable import supaterm

@MainActor
struct TerminalHorizontalTabLayoutAnimatorTests {
  @Test
  func ordinaryAndGroupExpansionTransitionsUseTheirDistinctCurves() throws {
    let animator = TerminalHorizontalTabLayoutAnimator(reduceMotion: { false })
    let ordinary = try #require(
      animator.makeAnimation(
        keyPath: "opacity",
        from: 0,
        to: 1,
        transition: .ordinary
      ) as? CABasicAnimation
    )
    #expect(!(ordinary is CASpringAnimation))
    #expect(ordinary.duration == 0.12)

    let expansion = try #require(
      animator.makeAnimation(
        keyPath: "opacity",
        from: 0,
        to: 1,
        transition: .groupExpansion
      ) as? CASpringAnimation
    )
    #expect(expansion.mass == 1)
    #expect(abs(expansion.stiffness - pow(2 * Double.pi / 0.3, 2)) < 0.001)
    #expect(abs(expansion.damping - 4 * Double.pi * 0.82 / 0.3) < 0.001)
    #expect(expansion.duration == expansion.settlingDuration)
  }

  @Test
  func reducedMotionAppliesTheLatestFrameAndCancelsRunningFrameAnimations() {
    let view = NSView(frame: CGRect(x: 0, y: 0, width: 80, height: 30))
    view.wantsLayer = true
    view.layer?.add(
      CABasicAnimation(keyPath: "position"),
      forKey: "horizontalTabPosition"
    )
    view.layer?.add(
      CABasicAnimation(keyPath: "bounds"),
      forKey: "horizontalTabBounds"
    )
    let animator = TerminalHorizontalTabLayoutAnimator(reduceMotion: { true })
    let finalFrame = CGRect(x: 160, y: 0, width: 180, height: 30)

    animator.setFrame(
      finalFrame,
      of: view,
      transition: .ordinary
    )

    #expect(view.frame == finalFrame)
    #expect(view.layer?.animation(forKey: "horizontalTabPosition") == nil)
    #expect(view.layer?.animation(forKey: "horizontalTabBounds") == nil)
  }

  @Test
  func reducedMotionRemovalHidesAccessibilityAndDetachesImmediately() {
    let container = NSView()
    let view = NSView()
    view.setAccessibilityElement(true)
    container.addSubview(view)
    let animator = TerminalHorizontalTabLayoutAnimator(reduceMotion: { true })

    animator.remove(view, transition: .groupExpansion)

    #expect(view.superview == nil)
    #expect(!view.isAccessibilityElement())
    #expect(view.layer?.animation(forKey: "horizontalTabRemoval") == nil)
  }
}
