import AppKit
import QuartzCore

enum TerminalSidebarAutoscrollDirection: Equatable {
  case up
  case down
}

enum TerminalSidebarAutoscrollBehavior {
  static let edgeSize: CGFloat = 60
  static let minimumVisibleHeight: CGFloat = 240
  static let directionTolerance: CGFloat = 20
  static let activationDelay: TimeInterval = 0.25
  static let minimumSpeed: CGFloat = 1
  static let maximumSpeed: CGFloat = 8
  private static let accelerationPerPoint: CGFloat = 0.25

  static func speed(towardEdgeDisplacement: CGFloat) -> CGFloat {
    let progress = min(
      max(towardEdgeDisplacement, 0) * accelerationPerPoint,
      1
    )
    return minimumSpeed + (maximumSpeed - minimumSpeed) * progress
  }

  static func towardEdgeDisplacement(
    direction: TerminalSidebarAutoscrollDirection,
    displacement: CGFloat
  ) -> CGFloat {
    switch direction {
    case .up:
      max(-displacement, 0)
    case .down:
      max(displacement, 0)
    }
  }

  static func signedDelta(
    direction: TerminalSidebarAutoscrollDirection,
    displacement: CGFloat
  ) -> CGFloat {
    let magnitude = speed(
      towardEdgeDisplacement: towardEdgeDisplacement(
        direction: direction,
        displacement: displacement
      )
    )
    return switch direction {
    case .up:
      -magnitude
    case .down:
      magnitude
    }
  }

  static func accepts(
    displacement: CGFloat,
    direction: TerminalSidebarAutoscrollDirection
  ) -> Bool {
    switch direction {
    case .up:
      displacement <= directionTolerance
    case .down:
      displacement >= -directionTolerance
    }
  }

  static func direction(
    pointerY: CGFloat,
    visibleRect: CGRect
  ) -> TerminalSidebarAutoscrollDirection? {
    direction(
      pointerY: pointerY - visibleRect.minY,
      viewportHeight: visibleRect.height
    )
  }

  static func direction(
    pointerY: CGFloat,
    viewportHeight: CGFloat
  ) -> TerminalSidebarAutoscrollDirection? {
    guard viewportHeight > minimumVisibleHeight else { return nil }
    guard 0...viewportHeight ~= pointerY else { return nil }
    if pointerY <= edgeSize { return .up }
    if pointerY >= viewportHeight - edgeSize { return .down }
    return nil
  }
}

enum TerminalSidebarAutoscrollState: Equatable {
  case initial
  case awaitingIdle(
    direction: TerminalSidebarAutoscrollDirection,
    anchorY: CGFloat,
    deadline: TimeInterval
  )
  case scrolling(
    direction: TerminalSidebarAutoscrollDirection,
    anchorY: CGFloat,
    signedDelta: CGFloat
  )

  var isActive: Bool {
    if case .initial = self { return false }
    return true
  }
}

enum TerminalSidebarAutoscrollReducer {
  @discardableResult
  static func update(
    state: inout TerminalSidebarAutoscrollState,
    pointerY: CGFloat,
    visibleRect: CGRect,
    timestamp: TimeInterval
  ) -> Bool {
    guard
      let nextDirection = TerminalSidebarAutoscrollBehavior.direction(
        pointerY: pointerY,
        visibleRect: visibleRect
      )
    else {
      state = .initial
      return false
    }

    switch state {
    case .initial:
      state = .awaitingIdle(
        direction: nextDirection,
        anchorY: pointerY,
        deadline: timestamp + TerminalSidebarAutoscrollBehavior.activationDelay
      )
    case .awaitingIdle(let direction, _, let deadline):
      guard direction == nextDirection else {
        state = .initial
        return false
      }
      state = .awaitingIdle(
        direction: direction,
        anchorY: pointerY,
        deadline: deadline
      )
    case .scrolling(let direction, let anchorY, _):
      guard direction == nextDirection else {
        state = .initial
        return false
      }
      let displacement = pointerY - anchorY
      guard
        TerminalSidebarAutoscrollBehavior.accepts(
          displacement: displacement,
          direction: direction
        )
      else {
        state = .initial
        return false
      }
      state = .scrolling(
        direction: direction,
        anchorY: anchorY,
        signedDelta: TerminalSidebarAutoscrollBehavior.signedDelta(
          direction: direction,
          displacement: displacement
        )
      )
    }
    return true
  }

  @discardableResult
  static func tick(
    state: inout TerminalSidebarAutoscrollState,
    timestamp: TimeInterval
  ) -> CGFloat? {
    switch state {
    case .initial:
      return nil
    case .awaitingIdle(let direction, let anchorY, let deadline):
      guard timestamp >= deadline else { return nil }
      let signedDelta = TerminalSidebarAutoscrollBehavior.signedDelta(
        direction: direction,
        displacement: 0
      )
      state = .scrolling(
        direction: direction,
        anchorY: anchorY,
        signedDelta: signedDelta
      )
      return signedDelta
    case .scrolling(_, _, let signedDelta):
      return signedDelta
    }
  }

  static func shiftAnchor(
    in state: inout TerminalSidebarAutoscrollState,
    by distance: CGFloat
  ) {
    switch state {
    case .initial:
      break
    case .awaitingIdle(let direction, let anchorY, let deadline):
      state = .awaitingIdle(
        direction: direction,
        anchorY: anchorY + distance,
        deadline: deadline
      )
    case .scrolling(let direction, let anchorY, let signedDelta):
      state = .scrolling(
        direction: direction,
        anchorY: anchorY + distance,
        signedDelta: signedDelta
      )
    }
  }
}

@MainActor
final class TerminalSidebarDragAutoscrollController {
  private weak var collectionView: NSCollectionView?
  private weak var scrollView: NSScrollView?
  private var pointerY: CGFloat?
  private var state = TerminalSidebarAutoscrollState.initial
  private var isLiveScrolling = false
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    scrollView: NSScrollView
  ) {
    self.collectionView = collectionView
    self.scrollView = scrollView
  }

  func setLiveScrolling(_ isLiveScrolling: Bool) {
    self.isLiveScrolling = isLiveScrolling
    if isLiveScrolling { stop() }
  }

  func update(pointerY: CGFloat) {
    guard !isLiveScrolling, let collectionView else {
      stop()
      return
    }
    let visibleRect = collectionView.visibleRect
    let contentHeight =
      collectionView.collectionViewLayout?.collectionViewContentSize.height
      ?? collectionView.frame.height
    guard contentHeight > visibleRect.height else {
      stop()
      return
    }

    guard
      TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: pointerY,
        visibleRect: visibleRect,
        timestamp: CACurrentMediaTime()
      )
    else {
      stop()
      return
    }
    self.pointerY = pointerY
    displayLinkDriver.start()
  }

  func stop() {
    pointerY = nil
    state = .initial
    displayLinkDriver.stop()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard
      let scrollView,
      let pointerY
    else {
      stop()
      return false
    }

    guard
      let signedDelta = TerminalSidebarAutoscrollReducer.tick(
        state: &state,
        timestamp: displayLink.timestamp
      )
    else { return state.isActive }

    let clipView = scrollView.contentView
    let previousY = clipView.bounds.origin.y
    let nextY = TerminalSidebarScrollGeometry.constrainedY(
      previousY + signedDelta,
      in: clipView
    )
    guard nextY != previousY else {
      return true
    }
    clipView.scroll(to: CGPoint(x: clipView.bounds.origin.x, y: nextY))
    scrollView.reflectScrolledClipView(clipView)
    let updatedPointerY = pointerY + nextY - previousY
    self.pointerY = updatedPointerY
    TerminalSidebarAutoscrollReducer.shiftAnchor(
      in: &state,
      by: nextY - previousY
    )
    return true
  }
}
