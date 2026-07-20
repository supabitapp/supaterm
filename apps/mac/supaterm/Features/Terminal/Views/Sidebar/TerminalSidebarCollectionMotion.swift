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

enum TerminalSidebarAutoscrollBehavior {
  static let edgeSize: CGFloat = 60
  static let minimumContentHeight: CGFloat = 240
  static let hysteresis: CGFloat = 20
  static let activationDelay: TimeInterval = 0.25
  static let minimumVelocity: CGFloat = 60
  static let maximumVelocity: CGFloat = 480

  static func velocity(penetration: CGFloat) -> CGFloat {
    minimumVelocity + (maximumVelocity - minimumVelocity) * max(0, min(penetration, 1))
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
  private enum Direction {
    case up
    case down
  }

  private weak var collectionView: NSCollectionView?
  private weak var scrollView: NSScrollView?
  private let onScroll: (CGFloat) -> Void
  private var pointerY: CGFloat?
  private var direction: Direction?
  private var enteredEdgeAt: TimeInterval?
  private var edgeEntryPointerY: CGFloat?
  private var lastFrameTimestamp: TimeInterval?
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
    self.pointerY = pointerY
    let visibleRect = collectionView.visibleRect
    guard visibleRect.minY...visibleRect.maxY ~= pointerY else {
      stop()
      return
    }
    let nextDirection: Direction?
    if pointerY < visibleRect.minY + TerminalSidebarAutoscrollBehavior.edgeSize {
      nextDirection = .up
    } else if pointerY > visibleRect.maxY - TerminalSidebarAutoscrollBehavior.edgeSize {
      nextDirection = .down
    } else {
      nextDirection = nil
    }
    guard let nextDirection else {
      stop()
      return
    }
    if direction != nextDirection {
      direction = nextDirection
      enteredEdgeAt = CACurrentMediaTime()
      edgeEntryPointerY = pointerY
    } else if let enteredEdgeAt,
      CACurrentMediaTime() - enteredEdgeAt < TerminalSidebarAutoscrollBehavior.activationDelay,
      let edgeEntryPointerY,
      movedInward(
        from: edgeEntryPointerY,
        to: pointerY,
        direction: nextDirection
      ) > TerminalSidebarAutoscrollBehavior.hysteresis
    {
      self.enteredEdgeAt = CACurrentMediaTime()
      self.edgeEntryPointerY = pointerY
    }
    displayLinkDriver.start()
  }

  func stop() {
    pointerY = nil
    direction = nil
    enteredEdgeAt = nil
    edgeEntryPointerY = nil
    lastFrameTimestamp = nil
    displayLinkDriver.stop()
  }

  private func update(_ displayLink: CADisplayLink) -> Bool {
    guard
      let collectionView,
      let scrollView,
      let pointerY,
      let direction,
      let enteredEdgeAt,
      displayLink.timestamp - enteredEdgeAt >= TerminalSidebarAutoscrollBehavior.activationDelay
    else { return direction != nil }
    let visibleRect = collectionView.visibleRect
    let penetration: CGFloat
    let sign: CGFloat
    switch direction {
    case .up:
      penetration =
        (visibleRect.minY + TerminalSidebarAutoscrollBehavior.edgeSize - pointerY)
        / TerminalSidebarAutoscrollBehavior.edgeSize
      sign = -1
    case .down:
      penetration =
        (pointerY - visibleRect.maxY + TerminalSidebarAutoscrollBehavior.edgeSize)
        / TerminalSidebarAutoscrollBehavior.edgeSize
      sign = 1
    }
    let previousTimestamp = lastFrameTimestamp ?? displayLink.timestamp
    let elapsed = max(0, min(displayLink.timestamp - previousTimestamp, 1.0 / 30.0))
    lastFrameTimestamp = displayLink.timestamp
    let step = TerminalSidebarAutoscrollBehavior.velocity(penetration: penetration) * elapsed
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
    direction: Direction
  ) -> CGFloat {
    switch direction {
    case .up: pointerY - entryPointerY
    case .down: entryPointerY - pointerY
    }
  }
}
