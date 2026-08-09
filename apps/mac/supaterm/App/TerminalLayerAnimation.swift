import QuartzCore

struct TerminalLayerSpring: Equatable {
  let response: TimeInterval
  let dampingRatio: CGFloat
}

enum TerminalLayerAnimation {
  static func spring(
    keyPath: String,
    from: Any,
    to: Any,
    spring: TerminalLayerSpring
  ) -> CASpringAnimation {
    let angularFrequency = 2 * CGFloat.pi / spring.response
    let animation = CASpringAnimation(keyPath: keyPath)
    animation.fromValue = from
    animation.toValue = to
    animation.mass = 1
    animation.stiffness = angularFrequency * angularFrequency
    animation.damping = 2 * spring.dampingRatio * angularFrequency
    animation.initialVelocity = 0
    animation.duration = animation.settlingDuration
    return animation
  }

  static func basic(
    keyPath: String,
    from: Any,
    to: Any,
    duration: TimeInterval,
    timingFunction: CAMediaTimingFunction
  ) -> CABasicAnimation {
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.fromValue = from
    animation.toValue = to
    animation.duration = duration
    animation.timingFunction = timingFunction
    return animation
  }
}
