import AppKit
import QuartzCore

enum TerminalSidebarAnimationCurve {
  static func standard(
    from: CGFloat,
    to: CGFloat,
    elapsed: TimeInterval,
    duration: TimeInterval
  ) -> CGFloat {
    guard duration > 0 else { return to }
    let progress = max(0, min(elapsed / duration, 1))
    let eased = 1 - pow(1 - progress, 3)
    return from + (to - from) * eased
  }
}

enum TerminalSidebarCollapseMotion {
  static let rowDuration: TimeInterval = 0.18
  static let firstInterval: TimeInterval = 0.024
  static let lastInterval: TimeInterval = 0.008

  static func delays(rowCount: Int) -> [TimeInterval] {
    guard rowCount > 0 else { return [] }
    guard rowCount > 1 else { return [0] }
    var result: [TimeInterval] = [0]
    for index in 0..<(rowCount - 1) {
      let progress = rowCount == 2 ? 0 : Double(index) / Double(rowCount - 2)
      let eased = 1 - pow(1 - progress, 2)
      let interval = firstInterval + (lastInterval - firstInterval) * eased
      result.append(result[index] + interval)
    }
    return result
  }

  static func visibility(
    elapsed: TimeInterval,
    delay: TimeInterval
  ) -> TerminalSidebarLayoutPlan.Visibility {
    let raw = max(0, min((elapsed - delay) / rowDuration, 1))
    let eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - pow(-2 * raw + 2, 3) / 2
    return TerminalSidebarLayoutPlan.Visibility(
      height: 1 - eased,
      alpha: max(1 - 2 * raw, 0)
    )
  }

  static func totalDuration(rowCount: Int) -> TimeInterval {
    (delays(rowCount: rowCount).last ?? 0) + rowDuration
  }
}

enum TerminalSidebarAutoscrollDirection: Equatable {
  case up
  case down
}

enum TerminalSidebarAutoscrollBehavior {
  static let edgeSize: CGFloat = 60
  static let minimumContentHeight: CGFloat = 240
  static let directionTolerance: CGFloat = 20
  static let activationDelay: TimeInterval = 0.25

  static func step(outwardDelta: CGFloat, isFirstTick: Bool) -> CGFloat {
    guard !isFirstTick else { return 1 }
    return 1 + 7 * min(max(outwardDelta, 0) * 0.25, 1)
  }

  static func direction(
    pointerY: CGFloat,
    visibleRect: CGRect
  ) -> TerminalSidebarAutoscrollDirection? {
    guard visibleRect.minY...visibleRect.maxY ~= pointerY else { return nil }
    if pointerY <= visibleRect.minY + edgeSize { return .up }
    if pointerY >= visibleRect.maxY - edgeSize { return .down }
    return nil
  }
}

struct TerminalSidebarDragVelocityTracker {
  private(set) var velocity = CGVector.zero
  private var lastPoint: CGPoint?
  private var lastTimestamp: TimeInterval?

  mutating func update(point: CGPoint, timestamp: TimeInterval) {
    guard let lastPoint, let lastTimestamp else {
      self.lastPoint = point
      self.lastTimestamp = timestamp
      velocity = .zero
      return
    }
    let elapsed = timestamp - lastTimestamp
    if elapsed > 0 {
      velocity = CGVector(
        dx: (point.x - lastPoint.x) / elapsed,
        dy: (point.y - lastPoint.y) / elapsed
      )
    }
    self.lastPoint = point
    self.lastTimestamp = timestamp
  }
}

enum TerminalSidebarDropMotion {
  enum Timing: Equatable {
    case easeOut
    case easeIn
    case easeInEaseOut
  }

  struct Path: Equatable {
    let positions: [CGPoint]
    let times: [CGFloat]
    let timings: [Timing]
    let duration: TimeInterval
  }

  static let duration: TimeInterval = 0.25

  static func path(
    start: CGPoint,
    destination: CGPoint,
    velocity: CGVector
  ) -> Path {
    let speed = hypot(velocity.dx, velocity.dy)
    let arc = min(speed * 0.002 + 2, 5)
    let midpoint = CGPoint(
      x: (start.x + destination.x) / 2,
      y: (start.y + destination.y) / 2 - arc
    )
    return Path(
      positions: [
        start,
        midpoint,
        destination,
        CGPoint(x: destination.x, y: destination.y + 1),
        destination,
      ],
      times: [0, 0.4, 0.7, 0.85, 1],
      timings: [.easeOut, .easeIn, .easeOut, .easeInEaseOut],
      duration: duration
    )
  }
}

enum TerminalSidebarTransformSpring {
  static let dampingRatio: CGFloat = 0.65
  static let response: TimeInterval = 0.25

  static var stiffness: CGFloat {
    let angularFrequency = 2 * CGFloat.pi / response
    return angularFrequency * angularFrequency
  }

  static var damping: CGFloat {
    2 * dampingRatio * sqrt(stiffness)
  }

  static func animation(from: CGFloat, to: CGFloat) -> CASpringAnimation {
    let animation = CASpringAnimation(keyPath: "transform.translation.y")
    animation.fromValue = from
    animation.toValue = to
    animation.mass = 1
    animation.stiffness = stiffness
    animation.damping = damping
    animation.initialVelocity = 0
    animation.duration = response
    return animation
  }

  static func positionAnimation(from: CGPoint, to: CGPoint) -> CASpringAnimation {
    let animation = CASpringAnimation(keyPath: "position")
    animation.fromValue = NSValue(point: from)
    animation.toValue = NSValue(point: to)
    animation.mass = 1
    animation.stiffness = stiffness
    animation.damping = damping
    animation.initialVelocity = 0
    animation.duration = response
    return animation
  }
}

enum TerminalSidebarDropRipple {
  static let stiffness: CGFloat = 130.5071656342394
  static let dampingRatio: CGFloat = 0.55

  static func scaleDelta(distance: CGFloat, focusSpan: CGFloat) -> CGFloat? {
    guard focusSpan > 0 else { return nil }
    let halfSpan = focusSpan / 2
    guard distance >= 0, distance < halfSpan else { return nil }
    let delta = 0.03 * exp(-3 * distance / halfSpan)
    return delta > 0.001 ? delta : nil
  }

  static func animation(
    scaleDelta: CGFloat,
    center: CGPoint,
    distance: CGFloat
  ) -> CASpringAnimation {
    var transform = CATransform3DIdentity
    transform = CATransform3DTranslate(transform, center.x, center.y, 0)
    transform = CATransform3DScale(transform, 1 + scaleDelta, 1 + scaleDelta, 1)
    transform = CATransform3DTranslate(transform, -center.x, -center.y, 0)

    let animation = CASpringAnimation(keyPath: "transform")
    animation.fromValue = NSValue(caTransform3D: transform)
    animation.toValue = NSValue(caTransform3D: CATransform3DIdentity)
    animation.isAdditive = true
    animation.mass = 1
    animation.stiffness = stiffness
    animation.damping = 2 * sqrt(stiffness * animation.mass) * dampingRatio
    animation.beginTime = CACurrentMediaTime() + 0.15 + distance * 0.0015
    animation.duration = animation.settlingDuration
    return animation
  }
}

enum TerminalSidebarLiveDragGeometry {
  static func fanSpacing(itemCount: Int) -> CGFloat {
    guard itemCount > 0 else { return 0 }
    return ceil(min(140 / CGFloat(itemCount), 7))
  }
}

enum TerminalSidebarScrollGeometry {
  static func constrainedY(_ proposedY: CGFloat, in clipView: NSClipView) -> CGFloat {
    let minimumY = clipView.documentRect.minY - clipView.contentInsets.top
    let maximumY = max(
      minimumY,
      clipView.documentRect.maxY - clipView.bounds.height + clipView.contentInsets.bottom
    )
    return max(minimumY, min(proposedY, maximumY))
  }
}

@MainActor
final class TerminalSidebarDisplayLinkDriver: NSObject {
  private weak var collectionView: NSCollectionView?
  private let onFrame: (CADisplayLink) -> Bool
  private var displayLink: CADisplayLink?

  init(
    collectionView: NSCollectionView?,
    onFrame: @escaping (CADisplayLink) -> Bool
  ) {
    self.collectionView = collectionView
    self.onFrame = onFrame
  }

  isolated deinit {
    displayLink?.invalidate()
  }

  func start() {
    guard displayLink == nil, let collectionView else { return }
    let displayLink = collectionView.displayLink(target: self, selector: #selector(update(_:)))
    displayLink.preferredFrameRateRange = CAFrameRateRange(
      minimum: 60,
      maximum: 120,
      preferred: 120
    )
    displayLink.add(to: .main, forMode: .common)
    self.displayLink = displayLink
  }

  func stop() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func update(_ displayLink: CADisplayLink) {
    if !onFrame(displayLink) { stop() }
  }
}

@MainActor
final class TerminalSidebarCollapseAnimator {
  private weak var collectionView: NSCollectionView?
  private let onFrame: ([TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility]) -> Void
  private let onCompletion: () -> Void
  private var rowIDs: [TerminalSidebarEntryID] = []
  private var delays: [TimeInterval] = []
  private var startedAt: TimeInterval = 0
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    onFrame: @escaping ([TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility]) -> Void,
    onCompletion: @escaping () -> Void
  ) {
    self.collectionView = collectionView
    self.onFrame = onFrame
    self.onCompletion = onCompletion
  }

  func start(rowIDs: [TerminalSidebarEntryID]) {
    cancel()
    self.rowIDs = rowIDs
    delays = TerminalSidebarCollapseMotion.delays(rowCount: rowIDs.count)
    startedAt = CACurrentMediaTime()
    displayLinkDriver.start()
  }

  func cancel() {
    displayLinkDriver.stop()
    rowIDs = []
    delays = []
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    let elapsed = displayLink.timestamp - startedAt
    onFrame(
      Dictionary(
        uniqueKeysWithValues: zip(rowIDs, delays).map { entryID, delay in
          (
            entryID,
            TerminalSidebarCollapseMotion.visibility(elapsed: elapsed, delay: delay)
          )
        }
      )
    )
    guard elapsed < TerminalSidebarCollapseMotion.totalDuration(rowCount: rowIDs.count) else {
      rowIDs = []
      delays = []
      onCompletion()
      return false
    }
    return true
  }
}

@MainActor
final class TerminalSidebarLayoutAnimator {
  private weak var collectionView: NSCollectionView?
  private weak var layout: TerminalSidebarCollectionLayout?
  private let onFrame: () -> Void
  private var startedAt: TimeInterval = 0
  private let duration: TimeInterval = 0.12
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    layout: TerminalSidebarCollectionLayout,
    onFrame: @escaping () -> Void
  ) {
    self.collectionView = collectionView
    self.layout = layout
    self.onFrame = onFrame
  }

  func animate(enabled: Bool, changes: () -> Void) {
    guard let layout else {
      changes()
      return
    }
    if enabled {
      layout.beginTransition()
    } else {
      finish()
    }
    changes()
    guard enabled else { return }
    startedAt = CACurrentMediaTime()
    displayLinkDriver.start()
  }

  func finish() {
    displayLinkDriver.stop()
    layout?.finishTransition()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard let layout else { return false }
    let elapsed = displayLink.timestamp - startedAt
    layout.updateTransition(
      progress: TerminalSidebarAnimationCurve.standard(
        from: 0,
        to: 1,
        elapsed: elapsed,
        duration: duration
      )
    )
    onFrame()
    guard elapsed < duration else {
      layout.finishTransition()
      return false
    }
    return true
  }
}

@MainActor
final class TerminalSidebarDragAutoscrollController {
  private weak var collectionView: NSCollectionView?
  private weak var scrollView: NSScrollView?
  private let onScroll: (CGFloat) -> Void
  private var pointerY: CGFloat?
  private var direction: TerminalSidebarAutoscrollDirection?
  private var enteredEdgeAt: TimeInterval?
  private var edgeEntryPointerY: CGFloat?
  private var outwardDelta: CGFloat = 0
  private var isFirstTick = true
  private var isLiveScrolling = false
  private lazy var displayLinkDriver = TerminalSidebarDisplayLinkDriver(
    collectionView: collectionView,
    onFrame: { [weak self] displayLink in self?.update(displayLink) ?? false }
  )

  init(
    collectionView: NSCollectionView,
    scrollView: NSScrollView,
    onScroll: @escaping (CGFloat) -> Void
  ) {
    self.collectionView = collectionView
    self.scrollView = scrollView
    self.onScroll = onScroll
  }

  func setLiveScrolling(_ isLiveScrolling: Bool) {
    self.isLiveScrolling = isLiveScrolling
    if isLiveScrolling { stop() }
  }

  func update(pointerY: CGFloat) {
    guard
      !isLiveScrolling,
      let collectionView,
      (collectionView.collectionViewLayout?.collectionViewContentSize.height
        ?? collectionView.frame.height) > TerminalSidebarAutoscrollBehavior.minimumContentHeight
    else {
      stop()
      return
    }
    let previousPointerY = self.pointerY
    self.pointerY = pointerY
    let visibleRect = collectionView.visibleRect
    guard
      let nextDirection = TerminalSidebarAutoscrollBehavior.direction(
        pointerY: pointerY,
        visibleRect: visibleRect
      )
    else {
      stop()
      return
    }
    if direction != nextDirection {
      direction = nextDirection
      enteredEdgeAt = CACurrentMediaTime()
      edgeEntryPointerY = pointerY
      outwardDelta = 0
      isFirstTick = true
    } else {
      outwardDelta =
        previousPointerY.map {
          movedOutward(from: $0, to: pointerY, direction: nextDirection)
        } ?? 0
      if let enteredEdgeAt,
        CACurrentMediaTime() - enteredEdgeAt < TerminalSidebarAutoscrollBehavior.activationDelay,
        let edgeEntryPointerY,
        movedInward(
          from: edgeEntryPointerY,
          to: pointerY,
          direction: nextDirection
        ) > TerminalSidebarAutoscrollBehavior.directionTolerance
      {
        self.enteredEdgeAt = CACurrentMediaTime()
        self.edgeEntryPointerY = pointerY
        outwardDelta = 0
        isFirstTick = true
      }
    }
    displayLinkDriver.start()
  }

  func stop() {
    pointerY = nil
    direction = nil
    enteredEdgeAt = nil
    edgeEntryPointerY = nil
    outwardDelta = 0
    isFirstTick = true
    displayLinkDriver.stop()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard
      let scrollView,
      let pointerY,
      let direction,
      let enteredEdgeAt,
      displayLink.timestamp - enteredEdgeAt >= TerminalSidebarAutoscrollBehavior.activationDelay
    else { return direction != nil }
    let sign: CGFloat
    switch direction {
    case .up:
      sign = -1
    case .down:
      sign = 1
    }
    let step = TerminalSidebarAutoscrollBehavior.step(
      outwardDelta: outwardDelta,
      isFirstTick: isFirstTick
    )
    isFirstTick = false
    let clipView = scrollView.contentView
    let previousY = clipView.bounds.origin.y
    let nextY = TerminalSidebarScrollGeometry.constrainedY(
      previousY + sign * step,
      in: clipView
    )
    guard nextY != previousY else {
      stop()
      return false
    }
    clipView.scroll(to: CGPoint(x: clipView.bounds.origin.x, y: nextY))
    scrollView.reflectScrolledClipView(clipView)
    let updatedPointerY = pointerY + nextY - previousY
    self.pointerY = updatedPointerY
    edgeEntryPointerY = edgeEntryPointerY.map { $0 + nextY - previousY }
    onScroll(updatedPointerY)
    return true
  }

  private func movedInward(
    from entryPointerY: CGFloat,
    to pointerY: CGFloat,
    direction: TerminalSidebarAutoscrollDirection
  ) -> CGFloat {
    switch direction {
    case .up: pointerY - entryPointerY
    case .down: entryPointerY - pointerY
    }
  }

  private func movedOutward(
    from previousPointerY: CGFloat,
    to pointerY: CGFloat,
    direction: TerminalSidebarAutoscrollDirection
  ) -> CGFloat {
    switch direction {
    case .up: max(previousPointerY - pointerY, 0)
    case .down: max(pointerY - previousPointerY, 0)
    }
  }
}
