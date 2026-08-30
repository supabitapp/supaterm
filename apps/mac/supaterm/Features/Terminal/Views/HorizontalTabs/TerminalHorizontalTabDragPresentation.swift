import AppKit
import QuartzCore

@MainActor
final class TerminalHorizontalTabDragPresentation {
  private struct HiddenView {
    weak var view: NSView?
    let alpha: CGFloat
  }

  static let sourceHoldInset: CGFloat = 8

  private weak var containerView: NSView?
  private var hiddenViews: [HiddenView] = []
  private var liftView: NSImageView?
  private(set) var sourceFrame: CGRect?
  private(set) var cleanupCount = 0
  private var hotspot = CGPoint.zero

  init(containerView: NSView) {
    self.containerView = containerView
  }

  var isActive: Bool {
    liftView != nil
  }

  var hiddenViewCount: Int {
    hiddenViews.count
  }

  func begin(
    sourceFrame: CGRect,
    hotspot: CGPoint,
    hiddenViews: [NSView]
  ) -> Bool {
    cleanup()
    guard
      sourceFrame.width > 0,
      sourceFrame.height > 0,
      let containerView,
      let image = sourceImage(in: sourceFrame, containerView: containerView)
    else { return false }
    let liftView = NSImageView(frame: sourceFrame)
    liftView.image = image
    liftView.imageScaling = .scaleAxesIndependently
    liftView.wantsLayer = true
    liftView.setAccessibilityElement(false)
    self.hiddenViews = hiddenViews.map {
      HiddenView(view: $0, alpha: $0.alphaValue)
    }
    for hiddenView in self.hiddenViews {
      hiddenView.view?.alphaValue = 0
    }
    containerView.addSubview(liftView, positioned: .above, relativeTo: nil)
    self.liftView = liftView
    self.sourceFrame = sourceFrame
    self.hotspot = hotspot
    return true
  }

  func move(
    to screenPoint: CGPoint,
    state: TerminalTabDragRegistry.PresentationState
  ) {
    guard let liftView, let containerView else { return }
    switch state {
    case .sourceSurface:
      let point = localPoint(for: screenPoint, in: containerView)
      liftView.frame.origin = CGPoint(
        x: point.x - hotspot.x,
        y: point.y - hotspot.y
      )
      liftView.isHidden = false
    case .sharedPreview:
      liftView.isHidden = true
    }
  }

  func settle(
    at destination: CGPoint,
    velocity: CGVector,
    reduceMotion: Bool,
    completion: @escaping () -> Void
  ) {
    guard let liftView, !liftView.isHidden, !reduceMotion, let layer = liftView.layer else {
      completion()
      return
    }
    let source = layer.presentation()?.position ?? layer.position
    let motion = TerminalSidebarDropMotion.path(
      start: source,
      destination: destination,
      velocity: velocity
    )
    let animation = CAKeyframeAnimation(keyPath: "position")
    animation.values = motion.positions.map { NSValue(point: $0) }
    animation.keyTimes = motion.times.map { NSNumber(value: Double($0)) }
    animation.timingFunctions = motion.timings.map(timingFunction)
    animation.duration = motion.duration
    let transform = CASpringAnimation(keyPath: "transform.scale")
    transform.fromValue = 1.03
    transform.toValue = 1
    transform.mass = 1
    transform.stiffness = pow(2 * Double.pi / 0.25, 2)
    transform.damping = 2 * 0.65 * sqrt(transform.stiffness)
    transform.duration = min(0.5, transform.settlingDuration)
    CATransaction.begin()
    CATransaction.setCompletionBlock(completion)
    CATransaction.setDisableActions(true)
    layer.position = destination
    layer.add(animation, forKey: "horizontalTabDropPosition")
    layer.add(transform, forKey: "horizontalTabDropTransform")
    CATransaction.commit()
  }

  func cleanup() {
    guard liftView != nil || !hiddenViews.isEmpty else { return }
    for hiddenView in hiddenViews {
      hiddenView.view?.alphaValue = hiddenView.alpha
    }
    hiddenViews = []
    liftView?.removeFromSuperview()
    liftView = nil
    sourceFrame = nil
    cleanupCount += 1
  }

  func sourceHoldScreenFrame() -> CGRect {
    guard let sourceFrame, let containerView else { return .null }
    let frame: CGRect
    if let window = containerView.window {
      frame = window.convertToScreen(containerView.convert(sourceFrame, to: nil))
    } else {
      frame = sourceFrame
    }
    return Self.expandedSourceHoldFrame(frame)
  }

  static func expandedSourceHoldFrame(_ frame: CGRect) -> CGRect {
    frame.insetBy(dx: -sourceHoldInset, dy: -sourceHoldInset)
  }

  private func localPoint(for screenPoint: CGPoint, in view: NSView) -> CGPoint {
    guard let window = view.window else { return screenPoint }
    return view.convert(window.convertPoint(fromScreen: screenPoint), from: nil)
  }

  private func sourceImage(in frame: CGRect, containerView: NSView) -> NSImage? {
    guard let representation = containerView.bitmapImageRepForCachingDisplay(in: frame) else {
      return nil
    }
    containerView.cacheDisplay(in: frame, to: representation)
    let image = NSImage(size: frame.size)
    image.addRepresentation(representation)
    return image
  }

  private func timingFunction(
    _ timing: TerminalSidebarDropMotion.Timing
  ) -> CAMediaTimingFunction {
    switch timing {
    case .easeOut:
      CAMediaTimingFunction(name: .easeOut)
    case .easeIn:
      CAMediaTimingFunction(name: .easeIn)
    case .easeInEaseOut:
      CAMediaTimingFunction(name: .easeInEaseOut)
    }
  }
}
