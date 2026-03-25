import AppKit
import Testing

@testable import supaterm

struct HorizontalSwipeGestureRecognizerTests {
  @Test
  func horizontalScrollTriggersNextAfterNegativeThreshold() {
    var recognizer = HorizontalSwipeGestureRecognizer(threshold: 25)

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 0,
        deltaY: 0,
        phase: .began,
        momentumPhase: []
      ) == .ignored
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: -12,
        deltaY: 1,
        phase: .changed,
        momentumPhase: []
      ) == .consumed
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: -14,
        deltaY: 1,
        phase: .changed,
        momentumPhase: []
      ) == .next
    )
  }

  @Test
  func horizontalScrollTriggersPreviousAfterPositiveThreshold() {
    var recognizer = HorizontalSwipeGestureRecognizer(threshold: 25)

    _ = recognizer.handle(
      hasPreciseScrollingDeltas: true,
      deltaX: 0,
      deltaY: 0,
      phase: .began,
      momentumPhase: []
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 30,
        deltaY: 2,
        phase: .changed,
        momentumPhase: []
      ) == .previous
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 8,
        deltaY: 1,
        phase: .changed,
        momentumPhase: []
      ) == .consumed
    )
  }

  @Test
  func verticalScrollIsIgnored() {
    var recognizer = HorizontalSwipeGestureRecognizer(threshold: 25)

    _ = recognizer.handle(
      hasPreciseScrollingDeltas: true,
      deltaX: 0,
      deltaY: 0,
      phase: .began,
      momentumPhase: []
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 2,
        deltaY: 30,
        phase: .changed,
        momentumPhase: []
      ) == .ignored
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 0,
        deltaY: 0,
        phase: .ended,
        momentumPhase: []
      ) == .ignored
    )
  }

  @Test
  func horizontalMomentumIsConsumedAndResetAfterEnd() {
    var recognizer = HorizontalSwipeGestureRecognizer(threshold: 25)

    _ = recognizer.handle(
      hasPreciseScrollingDeltas: true,
      deltaX: 0,
      deltaY: 0,
      phase: .began,
      momentumPhase: []
    )
    _ = recognizer.handle(
      hasPreciseScrollingDeltas: true,
      deltaX: -30,
      deltaY: 1,
      phase: .changed,
      momentumPhase: []
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: -5,
        deltaY: 0,
        phase: [],
        momentumPhase: .changed
      ) == .consumed
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 0,
        deltaY: 0,
        phase: .ended,
        momentumPhase: []
      ) == .consumed
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: 0,
        deltaY: 0,
        phase: .began,
        momentumPhase: []
      ) == .ignored
    )

    #expect(
      recognizer.handle(
        hasPreciseScrollingDeltas: true,
        deltaX: -30,
        deltaY: 1,
        phase: .changed,
        momentumPhase: []
      ) == .next
    )
  }
}
