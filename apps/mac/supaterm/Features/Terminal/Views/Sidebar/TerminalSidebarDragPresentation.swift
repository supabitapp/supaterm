import AppKit
import QuartzCore

private enum TerminalSidebarDragProjectionDisposition {
  case restoreSource
  case commitWithinSource
  case commitOutsideSource
}

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

  struct Ripple {
    let sourceFrame: CGRect
    let candidates: [RippleCandidate]
    let visibleSpan: CGFloat
  }

  struct Settlement {
    let targetFrames: [TerminalSidebarEntryID: CGRect]
    let groupFrame: CGRect?
    let accepted: Bool
    let motionPolicy: TerminalSidebarMotionPolicy
    let ripple: Ripple?
  }

  private weak var collectionView: NSCollectionView?
  private let performHaptic: () -> Void
  private var liveView: TerminalSidebarLiveDragView?
  private var hotspot = CGPoint.zero
  private var velocityTracker = TerminalSidebarDragVelocityTracker()
  private var hapticTracker = TerminalSidebarHapticTargetTracker()

  var sourceFrame: CGRect? { liveView?.sourceFrame }
  var groupID: TerminalTabGroupID? { liveView?.groupID }

  init(
    collectionView: NSCollectionView,
    performHaptic: @escaping () -> Void = {
      NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
    }
  ) {
    self.collectionView = collectionView
    self.performHaptic = performHaptic
  }

  func begin(
    _ lift: Lift,
    motionPolicy: TerminalSidebarMotionPolicy
  ) {
    finish(.restoreSource)
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

  func move(
    to screenPoint: CGPoint,
    presentationState: TerminalTabDragRegistry.PresentationState
  ) {
    guard
      let collectionView,
      let liveView,
      let window = collectionView.window
    else { return }
    velocityTracker.update(point: screenPoint, timestamp: CACurrentMediaTime())
    switch presentationState {
    case .sourceSurface:
      liveView.isHidden = false
    case .sharedPreview:
      liveView.isHidden = true
      return
    }
    let windowPoint = window.convertPoint(fromScreen: screenPoint)
    let pointer = collectionView.convert(windowPoint, from: nil)
    let horizontalBounds = TerminalSidebarLayout.cardHorizontalInsets.frame(
      in: collectionView.bounds
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

  func updateHapticTarget(
    _ path: TerminalSidebarSemanticPath?,
    enabled: Bool
  ) {
    if hapticTracker.shouldPerform(for: path), enabled {
      performHaptic()
    }
  }

  func resetHapticTarget() {
    hapticTracker.reset()
  }

  func handoffToSource(layoutSource: () -> Void) {
    handoff(.restoreSource, layout: layoutSource)
  }

  func handoffToDestination(layoutDestination: () -> Void) {
    handoff(.commitWithinSource, layout: layoutDestination)
  }

  func handoffAfterExternalSuccess(
    _ sourceDisposition: TerminalTabDragRegistry.SourceDisposition,
    layoutSource: () -> Void
  ) {
    switch sourceDisposition {
    case .retained:
      handoff(.restoreSource, layout: layoutSource)
    case .removed:
      handoff(.commitOutsideSource, layout: layoutSource)
    }
  }

  private func handoff(
    _ disposition: TerminalSidebarDragProjectionDisposition,
    layout: () -> Void
  ) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layout()
    finish(disposition)
    layout()
    CATransaction.commit()
  }

  func settle(
    _ settlement: Settlement,
    completion: @escaping @MainActor @Sendable () -> Void
  ) {
    guard let collectionView, let liveView else {
      completion()
      return
    }
    liveView.isHidden = false
    if let ripple = settlement.ripple {
      applyDropRipple(ripple)
    }
    guard
      let targets = liveView.settlementTargets(
        rowFrames: settlement.targetFrames,
        groupFrame: settlement.groupFrame,
        in: collectionView
      )
    else {
      completion()
      return
    }
    liveView.restoreShadow()
    let animatesSettlement =
      settlement.accepted
      ? settlement.motionPolicy.acceptedArc
      : settlement.motionPolicy.snapback
    guard animatesSettlement else {
      apply(targets)
      completion()
      return
    }
    let animations = targets.compactMap { target -> (CALayer, CGPoint)? in
      guard let layer = target.view.layer else { return nil }
      return (layer, (layer.presentation() ?? layer).position)
    }
    guard animations.count == targets.count else {
      completion()
      return
    }
    CATransaction.begin()
    CATransaction.setCompletionBlock {
      Task { @MainActor in completion() }
    }
    apply(targets)
    for (layer, start) in animations {
      let motion = TerminalSidebarDropMotion.path(
        start: start,
        destination: layer.position,
        velocity: velocityTracker.velocity
      )
      let positionAnimation = CAKeyframeAnimation(keyPath: "position")
      positionAnimation.values = motion.positions.map(NSValue.init(point:))
      positionAnimation.keyTimes = motion.times.map { NSNumber(value: Double($0)) }
      positionAnimation.timingFunctions = motion.timings.map(timingFunction)
      positionAnimation.duration = motion.duration
      layer.add(
        positionAnimation,
        forKey: settlement.accepted ? "acceptedDrop" : "cancelledDrop"
      )
    }
    CATransaction.commit()
  }

  private func apply(_ targets: [TerminalSidebarSettlementTarget]) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for target in targets {
      target.view.frame = target.frame
      target.view.layoutSubtreeIfNeeded()
    }
    CATransaction.commit()
  }

  private func finish(_ disposition: TerminalSidebarDragProjectionDisposition) {
    guard let collectionView else { return }
    liveView?.finish(in: collectionView, disposition: disposition)
    liveView?.removeFromSuperview()
    liveView = nil
    hotspot = .zero
    velocityTracker = TerminalSidebarDragVelocityTracker()
    hapticTracker.reset()
  }

  private func applyDropRipple(_ ripple: Ripple) {
    guard ripple.visibleSpan > 0, ripple.candidates.count >= 5 else { return }
    for candidate in ripple.candidates {
      let distance = TerminalSidebarDropRipple.distance(
        frame: candidate.frame,
        sourceFrame: ripple.sourceFrame
      )
      guard
        let scaleDelta = TerminalSidebarDropRipple.scaleDelta(
          distance: distance,
          visibleSpan: ripple.visibleSpan
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
private struct TerminalSidebarSettlementTarget {
  let view: NSView
  let frame: CGRect
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
struct TerminalSidebarLiftedSelectionSurface {
  let view: TerminalSidebarSelectionGlowView

  func install(
    in container: NSView,
    sourceRowFrame: CGRect,
    rowFrame: CGRect,
    above sibling: NSView?
  ) {
    view.frame = view.frame.offsetBy(
      dx: rowFrame.minX - sourceRowFrame.minX,
      dy: rowFrame.minY - sourceRowFrame.minY
    )
    container.addSubview(view, positioned: .above, relativeTo: sibling)
  }
}

@MainActor
private final class TerminalSidebarLiveDragView: NSView {
  private static let restingShadowOpacity: Float = 0.22
  private static let restingShadowRadius: CGFloat = 8
  private static let restingShadowOffset = CGSize(width: 0, height: -2)

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
    layer?.shadowOpacity = Self.restingShadowOpacity
    layer?.shadowRadius = Self.restingShadowRadius
    layer?.shadowOffset = Self.restingShadowOffset
    layer?.opacity = 0.96
    groupBackground?.install(in: self, relativeTo: frame)
    let fanSpacing = fanAnchorIndex.map { _ in
      TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: rows.count)
    }
    for (index, row) in rows.enumerated() {
      row.hostedView.wantsLayer = true
      let rowFrame: CGRect
      if let fanSpacing {
        rowFrame = CGRect(
          x: 0,
          y: CGFloat(index) * fanSpacing,
          width: frame.width,
          height: row.sourceFrame.height
        )
        row.hostedView.layer?.zPosition = index == fanAnchorIndex ? 1 : 0
      } else {
        rowFrame = TerminalSidebarLiveDragGeometry.rowFrame(
          sourceFrame: row.sourceFrame,
          containerFrame: frame
        )
      }
      row.selectedSurface?.install(
        in: self,
        sourceRowFrame: row.sourceFrame,
        rowFrame: rowFrame,
        above: groupBackground?.view
      )
      row.hostedView.frame = rowFrame
      addSubview(row.hostedView)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func lift() {
    guard let layer else { return }
    TerminalSidebarDragShadowMotion.lift(layer)
  }

  func restoreShadow() {
    guard let layer else { return }
    TerminalSidebarDragShadowMotion.restore(
      layer,
      opacity: Self.restingShadowOpacity,
      radius: Self.restingShadowRadius,
      offset: Self.restingShadowOffset
    )
  }

  func settlementTargets(
    rowFrames: [TerminalSidebarEntryID: CGRect],
    groupFrame: CGRect?,
    in collectionView: NSCollectionView
  ) -> [TerminalSidebarSettlementTarget]? {
    guard rows.allSatisfy({ rowFrames[$0.id] != nil }) else { return nil }
    var targets: [TerminalSidebarSettlementTarget] = []
    for row in rows {
      guard let frame = rowFrames[row.id] else { return nil }
      let targetFrame = convert(frame, from: collectionView)
      if let selectedSurface = row.selectedSurface {
        let offset = CGPoint(
          x: selectedSurface.view.frame.minX - row.hostedView.frame.minX,
          y: selectedSurface.view.frame.minY - row.hostedView.frame.minY
        )
        targets.append(
          TerminalSidebarSettlementTarget(
            view: selectedSurface.view,
            frame: targetFrame.offsetBy(dx: offset.x, dy: offset.y)
          )
        )
      }
      targets.append(TerminalSidebarSettlementTarget(view: row.hostedView, frame: targetFrame))
    }
    if let groupBackground, let groupFrame {
      targets.insert(
        TerminalSidebarSettlementTarget(
          view: groupBackground.view,
          frame: convert(groupFrame, from: collectionView)
        ),
        at: 0
      )
    }
    return targets
  }

  func finish(
    in collectionView: NSCollectionView,
    disposition: TerminalSidebarDragProjectionDisposition
  ) {
    switch disposition {
    case .restoreSource:
      for row in rows { row.restore() }
      groupBackground?.restore(in: collectionView)
    case .commitWithinSource:
      for row in rows { row.hostedView.removeFromSuperview() }
      groupBackground?.restore(in: collectionView)
    case .commitOutsideSource:
      for row in rows { row.hostedView.removeFromSuperview() }
      groupBackground?.view.removeFromSuperview()
    }
  }
}
