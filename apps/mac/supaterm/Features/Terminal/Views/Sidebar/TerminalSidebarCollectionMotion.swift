import AppKit
import QuartzCore

struct TerminalSidebarMotionPolicy: Equatable {
  let reduceMotion: Bool

  var lift: Bool { !reduceMotion }
  var targetInterpolation: Bool { !reduceMotion }
  var collapseStagger: Bool { !reduceMotion }
  var hoverFade: Bool { !reduceMotion }
  var acceptedArc: Bool { !reduceMotion }
  var snapback: Bool { !reduceMotion }
}

enum TerminalSidebarAnimationCurve {
  private static let firstControlPoint = CGPoint(x: 0.25, y: 0.46)
  private static let secondControlPoint = CGPoint(x: 0.45, y: 0.94)

  static var timingFunction: CAMediaTimingFunction {
    CAMediaTimingFunction(
      controlPoints: Float(firstControlPoint.x),
      Float(firstControlPoint.y),
      Float(secondControlPoint.x),
      Float(secondControlPoint.y)
    )
  }

  static func standard(
    from: CGFloat,
    to: CGFloat,
    elapsed: TimeInterval,
    duration: TimeInterval
  ) -> CGFloat {
    guard duration > 0 else { return to }
    let progress = max(0, min(elapsed / duration, 1))
    guard progress > 0 else { return from }
    guard progress < 1 else { return to }
    let eased = cubicBezierValue(at: progress)
    return from + (to - from) * eased
  }

  private static func cubicBezierValue(at progress: CGFloat) -> CGFloat {
    var lower: CGFloat = 0
    var upper: CGFloat = 1
    for _ in 0..<16 {
      let parameter = (lower + upper) / 2
      if cubicBezierCoordinate(
        parameter,
        first: firstControlPoint.x,
        second: secondControlPoint.x
      ) < progress {
        lower = parameter
      } else {
        upper = parameter
      }
    }
    return cubicBezierCoordinate(
      (lower + upper) / 2,
      first: firstControlPoint.y,
      second: secondControlPoint.y
    )
  }

  private static func cubicBezierCoordinate(
    _ parameter: CGFloat,
    first: CGFloat,
    second: CGFloat
  ) -> CGFloat {
    let inverse = 1 - parameter
    return 3 * inverse * inverse * parameter * first
      + 3 * inverse * parameter * parameter * second
      + parameter * parameter * parameter
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

enum TerminalSidebarLayoutMotion {
  static let defaultDuration: TimeInterval = 0.12

  static func animationDuration(
    from previous: TerminalSidebarOutline,
    to current: TerminalSidebarOutline
  ) -> TimeInterval {
    let currentGroupIDs = Set(
      current.roots.compactMap { root -> TerminalTabGroupID? in
        guard case .group(let id, _, _, _) = root.content else { return nil }
        return id
      }
    )
    let expandedGroupIDs = previous.collapsedGroupIDs
      .subtracting(current.collapsedGroupIDs)
      .intersection(currentGroupIDs)
    return expandedGroupIDs.isEmpty ? defaultDuration : TerminalSidebarCollapseMotion.rowDuration
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
      y: min(start.y, destination.y) - arc
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

enum TerminalSidebarDragShadowMotion {
  static let duration: TimeInterval = 0.2
  static let opacity: Float = 0.3
  static let radius: CGFloat = 8
  static let offset = CGSize(width: 0, height: 4)

  static func lift(_ layer: CALayer) {
    let animation = CAAnimationGroup()
    animation.animations = [
      basicAnimation(keyPath: "shadowOpacity", from: layer.shadowOpacity, to: opacity),
      basicAnimation(keyPath: "shadowRadius", from: layer.shadowRadius, to: radius),
      basicAnimation(keyPath: "shadowOffset", from: layer.shadowOffset, to: offset),
    ]
    animation.duration = duration
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.shadowOpacity = opacity
    layer.shadowRadius = radius
    layer.shadowOffset = offset
    CATransaction.commit()
    layer.add(animation, forKey: "liftShadow")
  }

  static func restore(
    _ layer: CALayer,
    opacity: Float,
    radius: CGFloat,
    offset: CGSize
  ) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.removeAnimation(forKey: "liftShadow")
    layer.shadowOpacity = opacity
    layer.shadowRadius = radius
    layer.shadowOffset = offset
    CATransaction.commit()
  }

  private static func basicAnimation(
    keyPath: String,
    from: Any,
    to: Any
  ) -> CABasicAnimation {
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.fromValue = from
    animation.toValue = to
    return animation
  }
}

enum TerminalSidebarLiveDragGeometry {
  static func fanSpacing(itemCount: Int) -> CGFloat {
    guard itemCount > 1 else { return 0 }
    return min(floor(140 / CGFloat(itemCount - 1)), 7)
  }

  static func fanFrame(
    anchorFrame: CGRect,
    rowHeights: [CGFloat],
    anchorIndex: Int
  ) -> CGRect {
    let spacing = fanSpacing(itemCount: rowHeights.count)
    let height =
      rowHeights.enumerated().map { index, height in
        CGFloat(index) * spacing + height
      }.max() ?? anchorFrame.height
    return CGRect(
      x: anchorFrame.minX,
      y: anchorFrame.minY - CGFloat(anchorIndex) * spacing,
      width: anchorFrame.width,
      height: height
    )
  }

  static func constrainedX(
    _ proposedX: CGFloat,
    frameWidth: CGFloat,
    bounds: CGRect
  ) -> CGFloat {
    let maximumX = max(bounds.minX, bounds.maxX - frameWidth)
    return max(bounds.minX, min(proposedX, maximumX))
  }

  static func rowFrame(
    sourceFrame: CGRect,
    containerFrame: CGRect
  ) -> CGRect {
    sourceFrame.offsetBy(
      dx: -containerFrame.minX,
      dy: -containerFrame.minY
    )
  }
}

enum TerminalSidebarScrollGeometry {
  static func constrainedY(_ proposedY: CGFloat, in clipView: NSClipView) -> CGFloat {
    constrainedY(
      proposedY,
      documentRect: clipView.documentRect,
      viewportHeight: clipView.bounds.height
    )
  }

  static func constrainedY(
    _ proposedY: CGFloat,
    documentRect: CGRect,
    viewportHeight: CGFloat
  ) -> CGFloat {
    let minimumY = documentRect.minY
    let maximumY = max(minimumY, documentRect.maxY - viewportHeight)
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
  private var duration = TerminalSidebarLayoutMotion.defaultDuration
  private var startedAt: TimeInterval = 0
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

  func animate(
    enabled: Bool,
    duration: TimeInterval = TerminalSidebarLayoutMotion.defaultDuration,
    changes: () -> Void
  ) {
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
    self.duration = duration
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
