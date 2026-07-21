import AppKit
import QuartzCore
import Testing

@testable import supaterm

struct TerminalSidebarMotionTests {
  @Test
  func activationRequiresSameEventThresholdAndExpandedContainment() {
    let frame = CGRect(x: 10, y: 10, width: 100, height: 30)

    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 37.9, y: 20),
        sourceFrame: frame
      ) == .pending
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 38, y: 20),
        sourceFrame: frame
      ) == .begin
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 42,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 38, y: 20),
        sourceFrame: frame
      ) == .rejected
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 119, y: 20),
        sourceFrame: frame
      ) == .rejected
    )
  }

  @Test
  func reduceMotionDisablesEveryDecorativeDragEffect() {
    let policy = TerminalSidebarMotionPolicy(reduceMotion: true)

    #expect(!policy.lift)
    #expect(!policy.targetInterpolation)
    #expect(!policy.collapseStagger)
    #expect(!policy.hoverFade)
    #expect(!policy.acceptedArc)
    #expect(!policy.ripple)
    #expect(!policy.snapback)
  }

  @Test
  func velocityAndAcceptedDropUseExactPath() {
    var tracker = TerminalSidebarDragVelocityTracker()
    tracker.update(point: CGPoint(x: 10, y: 20), timestamp: 1)
    tracker.update(point: CGPoint(x: 20, y: 15), timestamp: 1.5)
    let motion = TerminalSidebarDropMotion.path(
      start: .zero,
      destination: CGPoint(x: 20, y: 20),
      velocity: CGVector(dx: 1_000, dy: 0)
    )

    #expect(tracker.velocity == CGVector(dx: 20, dy: -10))
    #expect(
      motion.positions == [
        .zero,
        CGPoint(x: 10, y: 6),
        CGPoint(x: 20, y: 20),
        CGPoint(x: 20, y: 21),
        CGPoint(x: 20, y: 20),
      ]
    )
    #expect(motion.times == [0, 0.4, 0.7, 0.85, 1])
    #expect(motion.timings == [.easeOut, .easeIn, .easeOut, .easeInEaseOut])
    #expect(motion.duration == 0.25)
  }

  @Test
  func autoscrollTravelsTheSameDistanceAtSixtyAndOneTwentyHertz() {
    let distanceAt60 = (0..<60).reduce(CGFloat.zero) { total, _ in
      total + TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1 / 60)
    }
    let distanceAt120 = (0..<120).reduce(CGFloat.zero) { total, _ in
      total + TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1 / 120)
    }

    #expect(distanceAt60 == 480)
    #expect(distanceAt120 == 480)
  }

  @Test
  func autoscrollUsesTargetIntervalFirstCapsStallsAndResets() {
    var timing = TerminalSidebarAutoscrollTiming()
    let oneTwentyInterval = TimeInterval(1.0 / 120.0)
    let sixtyInterval = TimeInterval(1.0 / 60.0)
    let first = timing.interval(timestamp: 1, targetTimestamp: 1 + oneTwentyInterval)
    let second = timing.interval(timestamp: 1 + oneTwentyInterval, targetTimestamp: 2)

    #expect(abs(first - oneTwentyInterval) < 0.000_000_001)
    #expect(abs(second - oneTwentyInterval) < 0.000_000_001)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1) == 16)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 0, elapsed: 1 / 60) == 1)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: -4, elapsed: 1 / 60) == 1)
    timing.reset()
    let reset = timing.interval(timestamp: 3, targetTimestamp: 3 + sixtyInterval)
    #expect(abs(reset - sixtyInterval) < 0.000_000_001)
  }

  @Test
  func autoscrollEdgesAndBoundsStayExact() {
    let visible = CGRect(x: 0, y: 100, width: 220, height: 300)

    #expect(TerminalSidebarAutoscrollBehavior.edgeSize == 60)
    #expect(TerminalSidebarAutoscrollBehavior.activationDelay == 0.25)
    #expect(TerminalSidebarAutoscrollBehavior.directionTolerance == 20)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 160, visibleRect: visible) == .up)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 340, visibleRect: visible) == .down
    )
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 160.1, visibleRect: visible) == nil)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 99, visibleRect: visible) == nil)
  }

  @Test @MainActor
  func liftAndSettlementUseTheSameSpring() throws {
    let lift = TerminalSidebarTransformSpring.animation(from: 0, to: -2)
    let settlement = TerminalSidebarTransformSpring.animation(from: -2, to: 0)

    #expect(try #require(lift.fromValue as? NSNumber) == 0)
    #expect(try #require(lift.toValue as? NSNumber) == -2)
    #expect(try #require(settlement.fromValue as? NSNumber) == -2)
    #expect(try #require(settlement.toValue as? NSNumber) == 0)
    #expect(lift.stiffness == settlement.stiffness)
    #expect(lift.damping == settlement.damping)
  }

  @Test
  func livePreviewPreservesRowsBoundsAndSettlementGeometry() {
    let container = CGRect(x: 4, y: 50, width: 212, height: 180)
    let bounds = CGRect(x: 4, y: 0, width: 212, height: 400)

    #expect(
      TerminalSidebarLiveDragGeometry.rowFrame(
        sourceFrame: CGRect(x: 16, y: 92, width: 200, height: 56),
        containerFrame: container
      ) == CGRect(x: 12, y: 42, width: 200, height: 56)
    )
    #expect(TerminalSidebarLiveDragGeometry.constrainedX(-100, frameWidth: 212, bounds: bounds) == 4)
    #expect(TerminalSidebarLiveDragGeometry.constrainedX(100, frameWidth: 200, bounds: bounds) == 16)
    #expect(
      TerminalSidebarLiveDragGeometry.settlementPosition(
        currentLayerPosition: .zero,
        currentFrame: container,
        targetFrame: CGRect(x: 4, y: 300, width: 212, height: 180)
      ) == CGPoint(x: 0, y: 250)
    )
  }

  @Test
  func batchPreviewUsesACompactFanAnchoredToTheClickedRow() {
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 1) == 0)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 2) == 7)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 8) == 7)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 30) == 4)
    #expect(
      TerminalSidebarLiveDragGeometry.fanFrame(
        anchorFrame: CGRect(x: 12, y: 80, width: 200, height: 37),
        rowHeights: [37, 42, 51],
        anchorIndex: 1
      ) == CGRect(x: 12, y: 73, width: 200, height: 65)
    )
  }

  @Test
  func hapticTrackerFiresOnlyForPathChanges() {
    var tracker = TerminalSidebarHapticTargetTracker()
    let first = tracker.shouldPerform(for: .trailingRoot)
    let repeated = tracker.shouldPerform(for: .trailingRoot)
    let changed = tracker.shouldPerform(for: .pinnedEnd)
    let cleared = tracker.shouldPerform(for: nil)
    let restored = tracker.shouldPerform(for: .pinnedEnd)

    #expect(first)
    #expect(!repeated)
    #expect(changed)
    #expect(!cleared)
    #expect(restored)
  }
}
