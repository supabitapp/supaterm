import AppKit
import QuartzCore

@MainActor
final class TerminalHorizontalTabLayoutAnimator {
  enum Transition: Equatable {
    case none
    case ordinary
    case groupExpansion
  }

  private let reduceMotion: () -> Bool
  private var animationIDs: [ObjectIdentifier: UUID] = [:]

  init(reduceMotion: @escaping () -> Bool) {
    self.reduceMotion = reduceMotion
  }

  func remove(
    _ view: NSView?,
    transition: Transition
  ) {
    guard let view else { return }
    view.setAccessibilityElement(false)
    let key = ObjectIdentifier(view)
    animationIDs.removeValue(forKey: key)
    guard transition != .none, !reduceMotion(), view.window != nil, let layer = view.layer else {
      view.removeFromSuperview()
      return
    }
    let animationID = UUID()
    animationIDs[key] = animationID
    let animation = makeAnimation(
      keyPath: "opacity",
      from: layer.presentation()?.opacity ?? layer.opacity,
      to: 0,
      transition: transition
    )
    layerWithoutActions { layer.opacity = 0 }
    layer.add(animation, forKey: "horizontalTabRemoval")
    DispatchQueue.main.asyncAfter(deadline: .now() + animation.duration) { [weak self, weak view] in
      guard
        let self,
        let view,
        animationIDs[key] == animationID
      else { return }
      animationIDs.removeValue(forKey: key)
      view.removeFromSuperview()
    }
  }

  func animateInsertion(
    _ view: NSView,
    transition: Transition
  ) {
    guard transition != .none, !reduceMotion(), view.window != nil, let layer = view.layer else {
      return
    }
    let opacity = makeAnimation(
      keyPath: "opacity",
      from: 0,
      to: layer.opacity,
      transition: transition
    )
    let scale = makeAnimation(
      keyPath: "transform.scale",
      from: 0.98,
      to: 1,
      transition: transition
    )
    layer.add(opacity, forKey: "horizontalTabInsertionOpacity")
    layer.add(scale, forKey: "horizontalTabInsertionScale")
  }

  func setFrame(
    _ frame: CGRect,
    of view: NSView,
    transition: Transition
  ) {
    let key = ObjectIdentifier(view)
    guard transition != .none, !reduceMotion(), view.window != nil, let layer = view.layer else {
      animationIDs.removeValue(forKey: key)
      layerWithoutActions { view.frame = frame }
      view.layer?.removeAnimation(forKey: "horizontalTabPosition")
      view.layer?.removeAnimation(forKey: "horizontalTabBounds")
      return
    }
    let animationID = UUID()
    animationIDs[key] = animationID
    let oldPosition = layer.presentation()?.position ?? layer.position
    let oldBounds = layer.presentation()?.bounds ?? layer.bounds
    layerWithoutActions { view.frame = frame }
    let animationDuration: TimeInterval
    if oldPosition != layer.position {
      let animation = makeAnimation(
        keyPath: "position",
        from: NSValue(point: oldPosition),
        to: NSValue(point: layer.position),
        transition: transition
      )
      layer.add(animation, forKey: "horizontalTabPosition")
      animationDuration = animation.duration
    } else {
      animationDuration = 0
    }
    var completionDelay = animationDuration
    if oldBounds != layer.bounds {
      let animation = makeAnimation(
        keyPath: "bounds",
        from: NSValue(rect: oldBounds),
        to: NSValue(rect: layer.bounds),
        transition: transition
      )
      layer.add(animation, forKey: "horizontalTabBounds")
      completionDelay = max(completionDelay, animation.duration)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + completionDelay) { [weak self, weak view] in
      guard
        let self,
        let view,
        animationIDs[key] == animationID
      else { return }
      view.layer?.removeAnimation(forKey: "horizontalTabPosition")
      view.layer?.removeAnimation(forKey: "horizontalTabBounds")
      animationIDs.removeValue(forKey: key)
    }
  }

  func makeAnimation(
    keyPath: String,
    from: Any,
    to: Any,
    transition: Transition
  ) -> CAAnimation {
    switch transition {
    case .none:
      preconditionFailure()
    case .ordinary:
      let animation = CABasicAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      animation.duration = 0.12
      animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
      return animation
    case .groupExpansion:
      let animation = CASpringAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      animation.mass = 1
      animation.stiffness = pow(2 * Double.pi / 0.3, 2)
      animation.damping = 4 * Double.pi * 0.82 / 0.3
      animation.duration = animation.settlingDuration
      return animation
    }
  }

  private func layerWithoutActions(_ apply: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    apply()
    CATransaction.commit()
  }
}
