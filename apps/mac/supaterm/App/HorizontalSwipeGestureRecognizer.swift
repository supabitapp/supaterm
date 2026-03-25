import AppKit

enum HorizontalSwipeGestureResult: Equatable {
  case ignored
  case consumed
  case next
  case previous
}

struct HorizontalSwipeGestureRecognizer {
  private enum Axis {
    case horizontal
    case vertical
  }

  private let threshold: CGFloat
  private var scrollAccumulator: CGFloat = 0
  private var axis: Axis?
  private var hasTriggered = false

  init(threshold: CGFloat = 25) {
    self.threshold = threshold
  }

  mutating func handleScrollWheel(_ event: NSEvent) -> HorizontalSwipeGestureResult {
    handle(
      hasPreciseScrollingDeltas: event.hasPreciseScrollingDeltas,
      deltaX: event.scrollingDeltaX,
      deltaY: event.scrollingDeltaY,
      phase: event.phase,
      momentumPhase: event.momentumPhase
    )
  }

  mutating func handle(
    hasPreciseScrollingDeltas: Bool,
    deltaX: CGFloat,
    deltaY: CGFloat,
    phase: NSEvent.Phase,
    momentumPhase: NSEvent.Phase
  ) -> HorizontalSwipeGestureResult {
    guard hasPreciseScrollingDeltas else { return .ignored }

    if momentumPhase != [] {
      return axis == .horizontal ? .consumed : .ignored
    }

    if phase.contains(.began) {
      reset()
      return .ignored
    }

    if phase.contains(.changed) {
      if axis == nil {
        let absoluteX = abs(deltaX)
        let absoluteY = abs(deltaY)
        if absoluteX > 1 || absoluteY > 1 {
          axis = absoluteX > absoluteY ? .horizontal : .vertical
        }
      }

      guard axis == .horizontal else { return .ignored }

      if hasTriggered {
        return .consumed
      }

      scrollAccumulator += deltaX
      if scrollAccumulator > threshold {
        hasTriggered = true
        return .previous
      }
      if scrollAccumulator < -threshold {
        hasTriggered = true
        return .next
      }
      return .consumed
    }

    if phase.contains(.ended) || phase.contains(.cancelled) {
      let wasHorizontal = axis == .horizontal
      reset()
      return wasHorizontal ? .consumed : .ignored
    }

    return .ignored
  }

  private mutating func reset() {
    scrollAccumulator = 0
    axis = nil
    hasTriggered = false
  }
}
