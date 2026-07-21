import AppKit
import QuartzCore

@MainActor
final class TerminalSidebarDragPresentation {
  struct Lift {
    let rows: [TerminalSidebarLiftedRow]
    let groupBackground: TerminalSidebarLiftedGroupBackground?
    let fanAnchorIndex: Int?
    let sourceFrame: CGRect
    let hotspot: CGPoint
    let screenPoint: CGPoint
    let timestamp: TimeInterval
  }

  struct RippleCandidate {
    let layer: CALayer
    let frame: CGRect
    let center: CGPoint
  }

  struct Settlement {
    let targetFrame: CGRect
    let rippleFocusFrame: CGRect
    let accepted: Bool
    let motionPolicy: TerminalSidebarMotionPolicy
    let rippleCandidates: [RippleCandidate]
  }

  private weak var collectionView: NSCollectionView?
  private var liveView: TerminalSidebarLiveDragView?
  private var hotspot = CGPoint.zero
  private var velocityTracker = TerminalSidebarDragVelocityTracker()
  private var hapticTracker = TerminalSidebarHapticTargetTracker()

  var sourceFrame: CGRect? { liveView?.sourceFrame }
  var groupID: TerminalTabGroupID? { liveView?.groupID }

  init(collectionView: NSCollectionView) {
    self.collectionView = collectionView
  }

  func begin(
    _ lift: Lift,
    motionPolicy: TerminalSidebarMotionPolicy
  ) {
    finish()
    hotspot = lift.hotspot
    velocityTracker = TerminalSidebarDragVelocityTracker()
    velocityTracker.update(point: lift.screenPoint, timestamp: lift.timestamp)
    hapticTracker.reset()
    let liveView = TerminalSidebarLiveDragView(
      rows: lift.rows,
      groupBackground: lift.groupBackground,
      fanAnchorIndex: lift.fanAnchorIndex,
      frame: lift.sourceFrame
    )
    collectionView?.addSubview(liveView, positioned: .above, relativeTo: nil)
    self.liveView = liveView
    if motionPolicy.lift { liveView.lift() }
  }

  func move(to screenPoint: CGPoint) {
    guard
      let collectionView,
      let liveView,
      let window = collectionView.window
    else { return }
    velocityTracker.update(point: screenPoint, timestamp: CACurrentMediaTime())
    let windowPoint = window.convertPoint(fromScreen: screenPoint)
    let pointer = collectionView.convert(windowPoint, from: nil)
    let horizontalBounds = collectionView.bounds.insetBy(
      dx: TerminalSidebarLayoutPlan.horizontalInset,
      dy: 0
    )
    liveView.frame.origin = CGPoint(
      x: TerminalSidebarLiveDragGeometry.constrainedX(
        pointer.x - hotspot.x,
        frameWidth: liveView.frame.width,
        bounds: horizontalBounds
      ),
      y: pointer.y - hotspot.y
    )
  }

  func updateHapticTarget(_ path: TerminalSidebarSemanticPath?) {
    if hapticTracker.shouldPerform(for: path) {
      NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
    }
  }

  func resetHapticTarget() {
    hapticTracker.reset()
  }

  func settle(
    _ settlement: Settlement,
    completion: @escaping @MainActor @Sendable () -> Void
  ) {
    guard let liveView, let layer = liveView.layer else {
      completion()
      return
    }
    if settlement.accepted, settlement.motionPolicy.ripple {
      applyDropRipple(
        candidates: settlement.rippleCandidates,
        focusFrame: settlement.rippleFocusFrame
      )
    }
    let destination = TerminalSidebarLiveDragGeometry.settlementPosition(
      currentLayerPosition: layer.position,
      currentFrame: liveView.frame,
      targetFrame: settlement.targetFrame
    )
    let animatesSettlement =
      settlement.accepted
      ? settlement.motionPolicy.acceptedArc
      : settlement.motionPolicy.snapback
    guard animatesSettlement else {
      liveView.frame = settlement.targetFrame
      completion()
      return
    }
    let positionAnimation: CAAnimation
    if settlement.accepted {
      let motion = TerminalSidebarDropMotion.path(
        start: layer.position,
        destination: destination,
        velocity: velocityTracker.velocity
      )
      let animation = CAKeyframeAnimation(keyPath: "position")
      animation.values = motion.positions.map(NSValue.init(point:))
      animation.keyTimes = motion.times.map { NSNumber(value: Double($0)) }
      animation.timingFunctions = motion.timings.map(timingFunction)
      animation.duration = motion.duration
      positionAnimation = animation
    } else {
      positionAnimation = TerminalSidebarTransformSpring.positionAnimation(
        from: layer.position,
        to: destination
      )
    }
    positionAnimation.isRemovedOnCompletion = true
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.position = destination
    let translation =
      (layer.presentation()?.value(forKeyPath: "transform.translation.y") as? NSNumber).map {
        CGFloat(truncating: $0)
      }
      ?? -2
    layer.setValue(0, forKeyPath: "transform.translation.y")
    CATransaction.setCompletionBlock {
      Task { @MainActor in completion() }
    }
    layer.add(
      TerminalSidebarTransformSpring.animation(from: translation, to: 0),
      forKey: "settleLift"
    )
    layer.add(
      positionAnimation,
      forKey: settlement.accepted ? "acceptedDrop" : "cancelledDrop"
    )
    CATransaction.commit()
  }

  func finish() {
    guard let collectionView else { return }
    liveView?.restore(in: collectionView)
    liveView?.removeFromSuperview()
    liveView = nil
    hotspot = .zero
    velocityTracker = TerminalSidebarDragVelocityTracker()
    hapticTracker.reset()
  }

  private func applyDropRipple(candidates: [RippleCandidate], focusFrame: CGRect) {
    guard focusFrame.height > 0, candidates.count >= 5 else { return }
    for candidate in candidates {
      let distance: CGFloat
      if candidate.frame.midY < focusFrame.minY {
        distance = focusFrame.minY - candidate.frame.midY
      } else if candidate.frame.midY > focusFrame.maxY {
        distance = candidate.frame.midY - focusFrame.maxY
      } else {
        distance = 0
      }
      guard
        let scaleDelta = TerminalSidebarDropRipple.scaleDelta(
          distance: distance,
          focusSpan: focusFrame.height
        )
      else { continue }
      candidate.layer.add(
        TerminalSidebarDropRipple.animation(
          scaleDelta: scaleDelta,
          center: candidate.center,
          distance: distance
        ),
        forKey: "dropRipple"
      )
    }
  }

  private func timingFunction(
    _ timing: TerminalSidebarDropMotion.Timing
  ) -> CAMediaTimingFunction {
    switch timing {
    case .easeOut: CAMediaTimingFunction(name: .easeOut)
    case .easeIn: CAMediaTimingFunction(name: .easeIn)
    case .easeInEaseOut: CAMediaTimingFunction(name: .easeInEaseOut)
    }
  }
}

@MainActor
struct TerminalSidebarLiftedGroupBackground {
  let id: TerminalTabGroupID
  let view: TerminalSidebarGroupBackgroundView
  let sourceFrame: CGRect

  func install(in container: NSView, relativeTo containerFrame: CGRect) {
    view.frame = sourceFrame.offsetBy(dx: -containerFrame.minX, dy: -containerFrame.minY)
    container.addSubview(view, positioned: .below, relativeTo: nil)
  }

  func restore(in collectionView: NSCollectionView) {
    view.removeFromSuperview()
    collectionView.addSubview(view, positioned: .below, relativeTo: nil)
    view.frame = sourceFrame
  }
}

@MainActor
private final class TerminalSidebarLiveDragView: NSView {
  private let rows: [TerminalSidebarLiftedRow]
  private let groupBackground: TerminalSidebarLiftedGroupBackground?
  let sourceFrame: CGRect

  var groupID: TerminalTabGroupID? { groupBackground?.id }

  init(
    rows: [TerminalSidebarLiftedRow],
    groupBackground: TerminalSidebarLiftedGroupBackground?,
    fanAnchorIndex: Int?,
    frame: CGRect
  ) {
    self.rows = rows
    self.groupBackground = groupBackground
    sourceFrame = frame
    super.init(frame: frame)
    wantsLayer = true
    layer?.zPosition = 200
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.22
    layer?.shadowRadius = 8
    layer?.shadowOffset = CGSize(width: 0, height: -2)
    layer?.opacity = 0.96
    groupBackground?.install(in: self, relativeTo: frame)
    let fanSpacing = fanAnchorIndex.map { _ in
      TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: rows.count)
    }
    for (index, row) in rows.enumerated() {
      if let fanSpacing {
        row.hostedView.frame = CGRect(
          x: 0,
          y: CGFloat(index) * fanSpacing,
          width: frame.width,
          height: row.sourceFrame.height
        )
        row.hostedView.wantsLayer = true
        row.hostedView.layer?.zPosition = index == fanAnchorIndex ? 1 : 0
      } else {
        row.hostedView.frame = TerminalSidebarLiveDragGeometry.rowFrame(
          sourceFrame: row.sourceFrame,
          containerFrame: frame
        )
      }
      addSubview(row.hostedView)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func lift() {
    guard let layer else { return }
    layer.setValue(-2, forKeyPath: "transform.translation.y")
    layer.add(TerminalSidebarTransformSpring.animation(from: 0, to: -2), forKey: "lift")
  }

  func restore(in collectionView: NSCollectionView) {
    for row in rows { row.restore() }
    groupBackground?.restore(in: collectionView)
  }
}
