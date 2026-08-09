import AppKit

nonisolated enum TerminalTabSplitDropPresentation: Equatable {
  case hidden
  case available
  case targeted(TerminalTabSplitSide)

  var activeSide: TerminalTabSplitSide? {
    guard case .targeted(let side) = self else { return nil }
    return side
  }

  var isVisible: Bool {
    self != .hidden
  }
}

struct TerminalTabSplitDropLayout: Equatable {
  let leftFrame: CGRect
  let rightFrame: CGRect

  init(bounds: CGRect, scale: CGFloat = 1) {
    guard !bounds.isEmpty else {
      leftFrame = .zero
      rightFrame = .zero
      return
    }
    let widthLimit = min(345, max(140, bounds.width / 3))
    let shortSide = min(widthLimit, bounds.height * 0.8 / 1.6)
    let size = CGSize(
      width: ceil(shortSide * scale),
      height: ceil(shortSide * scale * 1.6)
    )
    let y = bounds.midY - size.height / 2
    leftFrame = CGRect(x: bounds.minX + 22, y: y, width: size.width, height: size.height)
    rightFrame = CGRect(
      x: bounds.maxX - 22 - size.width,
      y: y,
      width: size.width,
      height: size.height
    )
  }

  func frame(for side: TerminalTabSplitSide) -> CGRect {
    side == .left ? leftFrame : rightFrame
  }
}

enum TerminalTabSplitDropFeedback: Equatable {
  case entered
  case exited

  static func transition(
    from oldPresentation: TerminalTabSplitDropPresentation,
    to newPresentation: TerminalTabSplitDropPresentation
  ) -> Self? {
    switch (oldPresentation, newPresentation) {
    case (.targeted, .available):
      .exited
    case (.targeted(let oldSide), .targeted(let newSide)) where oldSide != newSide:
      .entered
    case (.hidden, .targeted), (.available, .targeted):
      .entered
    default:
      nil
    }
  }
}

enum TerminalTabSplitTargetMotion {
  static let compactScale: CGFloat = 0.65
  static let activeScale: CGFloat = 1.15
  static let geometrySpring = TerminalLayerSpring(response: 0.25, dampingRatio: 0.82)
  static let positionSpring = TerminalLayerSpring(response: 0.45, dampingRatio: 0.6)
  static let hoverSpring = TerminalLayerSpring(response: 0.2, dampingRatio: 0.9)
  static let hideSpring = TerminalLayerSpring(response: 0.2, dampingRatio: 0.7)
  static let colorDuration: TimeInterval = 0.2

  static func showSpring(response: TimeInterval) -> TerminalLayerSpring {
    TerminalLayerSpring(response: response, dampingRatio: 0.7)
  }

  static func activeSide(
    at point: CGPoint,
    in layout: TerminalTabSplitDropLayout,
    currentSide: TerminalTabSplitSide?
  ) -> TerminalTabSplitSide? {
    if let currentSide,
      contains(point, in: layout.frame(for: currentSide), divisor: 1.7, inclusive: true)
    {
      return currentSide
    }
    if contains(point, in: layout.leftFrame, divisor: 2, inclusive: false) {
      return .left
    }
    if contains(point, in: layout.rightFrame, divisor: 2, inclusive: false) {
      return .right
    }
    return nil
  }

  static func frame(
    for side: TerminalTabSplitSide,
    in layout: TerminalTabSplitDropLayout,
    point: CGPoint?,
    activeSide: TerminalTabSplitSide?
  ) -> CGRect {
    let frame = layout.frame(for: side)
    guard let point, frame.contains(point) else { return frame }
    let delta = CGPoint(x: point.x - frame.midX, y: point.y - frame.midY)
    let distance = hypot(delta.x, delta.y)
    guard distance > 0 else { return frame }
    let offset: CGPoint
    if activeSide == side {
      let radius = influenceRadius(for: frame) / 1.7
      offset = CGPoint(
        x: attachedOffset(delta.x, radius: radius),
        y: attachedOffset(delta.y, radius: radius)
      )
    } else {
      let radius = influenceRadius(for: frame)
      let influence = max(0, min(1, 1 - distance / radius))
      let magnitude = min(min(frame.width, frame.height) / 3.5, 100) * influence * influence
      offset = CGPoint(
        x: delta.x * magnitude / distance,
        y: delta.y * magnitude / distance
      )
    }
    return frame.offsetBy(dx: offset.x, dy: offset.y)
  }

  private static func contains(
    _ point: CGPoint,
    in frame: CGRect,
    divisor: CGFloat,
    inclusive: Bool
  ) -> Bool {
    let distance = hypot(point.x - frame.midX, point.y - frame.midY)
    let radius = influenceRadius(for: frame) / divisor
    return inclusive ? distance <= radius : distance < radius
  }

  private static func attachedOffset(_ delta: CGFloat, radius: CGFloat) -> CGFloat {
    guard delta != 0, radius > 0 else { return 0 }
    return delta.sign == .minus
      ? -radius * (1 - 1 / (1 + 0.8 * abs(delta) / radius))
      : radius * (1 - 1 / (1 + 0.8 * abs(delta) / radius))
  }

  private static func influenceRadius(for frame: CGRect) -> CGFloat {
    min(min(frame.width, frame.height) / 2, 500)
  }
}

@MainActor
final class TerminalTabSplitDropOverlayView: NSView {
  private struct RenderState: Equatable {
    let presentation: TerminalTabSplitDropPresentation
    let point: CGPoint?
    let sharedPreviewReady: Bool

    static let hidden = RenderState(
      presentation: .hidden,
      point: nil,
      sharedPreviewReady: false
    )
  }

  private let leftTarget = TerminalTabSplitTargetView(side: .left)
  private let rightTarget = TerminalTabSplitTargetView(side: .right)
  private let reduceMotion: () -> Bool
  private let performHaptic: (TerminalTabSplitDropFeedback) -> Void
  private let nextShowResponse: () -> TimeInterval
  private var renderState = RenderState.hidden

  init(
    reduceMotion: @escaping () -> Bool = {
      NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    },
    nextShowResponse: @escaping () -> TimeInterval = {
      .random(in: 0.15..<0.3)
    },
    performHaptic: @escaping (TerminalTabSplitDropFeedback) -> Void = { feedback in
      NSHapticFeedbackManager.defaultPerformer.perform(
        feedback == .entered ? .generic : .levelChange,
        performanceTime: .now
      )
    }
  ) {
    self.reduceMotion = reduceMotion
    self.nextShowResponse = nextShowResponse
    self.performHaptic = performHaptic
    super.init(frame: .zero)
    wantsLayer = true
    addSubview(leftTarget)
    addSubview(rightTarget)
    alphaValue = 0
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  override func layout() {
    super.layout()
    guard renderState.presentation.isVisible else { return }
    applyFrames(state: renderState, spring: nil)
  }

  func target(at point: CGPoint) -> TerminalTabSplitSide? {
    TerminalTabSplitTargetMotion.activeSide(
      at: point,
      in: TerminalTabSplitDropLayout(
        bounds: bounds,
        scale: renderState.sharedPreviewReady ? 1 : TerminalTabSplitTargetMotion.compactScale
      ),
      currentSide: renderState.presentation.activeSide
    )
  }

  func render(
    _ presentation: TerminalTabSplitDropPresentation,
    at point: CGPoint?,
    sharedPreviewReady: Bool
  ) {
    precondition(presentation == .hidden || point != nil)
    let state = RenderState(
      presentation: presentation,
      point: presentation.isVisible ? point : nil,
      sharedPreviewReady: presentation.isVisible && sharedPreviewReady
    )
    guard state != renderState else { return }
    let oldState = renderState
    renderState = state
    switch (oldState.presentation.isVisible, presentation.isVisible) {
    case (false, true):
      show(state: state)
    case (true, true):
      update(
        state: state,
        readinessChanged: oldState.sharedPreviewReady != state.sharedPreviewReady
      )
    case (true, false):
      hide()
    case (false, false):
      break
    }
    if let feedback = TerminalTabSplitDropFeedback.transition(
      from: oldState.presentation,
      to: presentation
    ) {
      performHaptic(feedback)
    }
  }

  func renderedTargetLayer(for side: TerminalTabSplitSide) -> CALayer? {
    targetView(for: side).layer
  }

  private func show(state: RenderState) {
    alphaValue = 0
    leftTarget.setActive(false, animated: false)
    rightTarget.setActive(false, animated: false)
    alphaValue = 1
    layoutSubtreeIfNeeded()
    let compactLayout = TerminalTabSplitDropLayout(
      bounds: bounds,
      scale: TerminalTabSplitTargetMotion.compactScale
    )
    leftTarget.setFrame(compactLayout.leftFrame, spring: nil)
    rightTarget.setFrame(compactLayout.rightFrame, spring: nil)
    let activeSide = state.presentation.activeSide
    guard !reduceMotion() else {
      leftTarget.setActive(activeSide == .left, animated: false)
      rightTarget.setActive(activeSide == .right, animated: false)
      applyFrames(state: state, spring: nil)
      leftTarget.show(transformSpring: nil, opacitySpring: nil)
      rightTarget.show(transformSpring: nil, opacitySpring: nil)
      return
    }
    leftTarget.show(
      transformSpring: TerminalTabSplitTargetMotion.showSpring(response: nextShowResponse()),
      opacitySpring: TerminalTabSplitTargetMotion.showSpring(response: nextShowResponse())
    )
    rightTarget.show(
      transformSpring: TerminalTabSplitTargetMotion.showSpring(response: nextShowResponse()),
      opacitySpring: TerminalTabSplitTargetMotion.showSpring(response: nextShowResponse())
    )
    applyFrames(
      state: state,
      spring: state.sharedPreviewReady
        ? TerminalTabSplitTargetMotion.geometrySpring
        : TerminalTabSplitTargetMotion.positionSpring
    )
    leftTarget.setActive(activeSide == .left, animated: true)
    rightTarget.setActive(activeSide == .right, animated: true)
  }

  private func update(state: RenderState, readinessChanged: Bool) {
    let animated = !reduceMotion()
    let spring: TerminalLayerSpring? =
      if !animated {
        nil
      } else if readinessChanged {
        TerminalTabSplitTargetMotion.geometrySpring
      } else {
        TerminalTabSplitTargetMotion.positionSpring
      }
    applyFrames(state: state, spring: spring)
    let activeSide = state.presentation.activeSide
    leftTarget.setActive(activeSide == .left, animated: animated)
    rightTarget.setActive(activeSide == .right, animated: animated)
  }

  private func hide() {
    let animated = !reduceMotion()
    guard animated else {
      leftTarget.hide(spring: nil)
      rightTarget.hide(spring: nil)
      alphaValue = 0
      leftTarget.setActive(false, animated: false)
      rightTarget.setActive(false, animated: false)
      return
    }
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in
      Task { @MainActor in
        guard let self, self.renderState.presentation == .hidden else { return }
        self.alphaValue = 0
        self.leftTarget.setActive(false, animated: false)
        self.rightTarget.setActive(false, animated: false)
      }
    }
    leftTarget.hide(spring: TerminalTabSplitTargetMotion.hideSpring)
    rightTarget.hide(spring: TerminalTabSplitTargetMotion.hideSpring)
    CATransaction.commit()
  }

  private func applyFrames(state: RenderState, spring: TerminalLayerSpring?) {
    let layout = TerminalTabSplitDropLayout(
      bounds: bounds,
      scale: state.sharedPreviewReady ? 1 : TerminalTabSplitTargetMotion.compactScale
    )
    leftTarget.setFrame(
      TerminalTabSplitTargetMotion.frame(
        for: .left,
        in: layout,
        point: state.point,
        activeSide: state.presentation.activeSide
      ),
      spring: spring
    )
    rightTarget.setFrame(
      TerminalTabSplitTargetMotion.frame(
        for: .right,
        in: layout,
        point: state.point,
        activeSide: state.presentation.activeSide
      ),
      spring: spring
    )
  }

  private func targetView(for side: TerminalTabSplitSide) -> TerminalTabSplitTargetView {
    side == .left ? leftTarget : rightTarget
  }
}

@MainActor
private final class TerminalTabSplitTargetView: NSView {
  private let wrapperView = NSView()
  private let shadowView = NSView()
  private let containerView = NSVisualEffectView()
  private let iconView = NSImageView()
  private let label = NSTextField(labelWithString: "")
  private let stackView = NSStackView()
  private let activeTintLayer = CALayer()
  private let outlineLayer = CAShapeLayer()
  private var isActive = false

  init(side: TerminalTabSplitSide) {
    super.init(frame: .zero)
    wantsLayer = true
    wrapperView.wantsLayer = true
    shadowView.wantsLayer = true
    containerView.wantsLayer = true
    containerView.blendingMode = .withinWindow
    containerView.material = .sheet
    containerView.layer?.cornerRadius = 20
    containerView.layer?.cornerCurve = .continuous
    containerView.layer?.masksToBounds = true
    shadowView.layer?.cornerRadius = 20
    shadowView.layer?.cornerCurve = .continuous
    shadowView.layer?.shadowColor = NSColor.black.cgColor
    shadowView.layer?.shadowOpacity = 0.3
    shadowView.layer?.shadowRadius = 16
    shadowView.layer?.shadowOffset = CGSize(width: 0, height: 2)
    activeTintLayer.zPosition = 2
    outlineLayer.zPosition = 3
    outlineLayer.fillColor = NSColor.clear.cgColor
    outlineLayer.lineDashPattern = [6, 6]
    outlineLayer.lineWidth = 2
    iconView.image = NSImage(
      systemSymbolName: side == .left
        ? "rectangle.lefthalf.filled"
        : "rectangle.righthalf.filled",
      accessibilityDescription: nil
    )
    iconView.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 16, weight: .semibold)
    label.stringValue = side == .left ? "Add left split" : "Add right split"
    label.font = .systemFont(ofSize: 14, weight: .semibold)
    label.alignment = .center
    stackView.orientation = .vertical
    stackView.alignment = .centerX
    stackView.spacing = 16
    stackView.edgeInsets = NSEdgeInsets(top: 4, left: 4, bottom: 4, right: 4)
    stackView.translatesAutoresizingMaskIntoConstraints = false
    stackView.addArrangedSubview(iconView)
    stackView.addArrangedSubview(label)
    containerView.layer?.addSublayer(activeTintLayer)
    containerView.layer?.addSublayer(outlineLayer)
    containerView.addSubview(stackView)
    NSLayoutConstraint.activate([
      stackView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
      stackView.centerYAnchor.constraint(equalTo: containerView.centerYAnchor),
    ])
    wrapperView.addSubview(shadowView)
    wrapperView.addSubview(containerView)
    addSubview(wrapperView)
    applyStyle(animated: false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func layout() {
    super.layout()
    wrapperView.frame = inset(bounds, by: 15)
    shadowView.frame = wrapperView.bounds
    containerView.frame = wrapperView.bounds
    activeTintLayer.frame = containerView.bounds
    outlineLayer.frame = inset(containerView.bounds, by: 10)
    outlineLayer.path = CGPath(
      roundedRect: outlineLayer.bounds,
      cornerWidth: 10,
      cornerHeight: 10,
      transform: nil
    )
    shadowView.layer?.shadowPath = CGPath(
      roundedRect: shadowView.bounds,
      cornerWidth: 20,
      cornerHeight: 20,
      transform: nil
    )
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    applyStyle(animated: false)
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    applyStyle(animated: false)
  }

  func setFrame(_ frame: CGRect, spring: TerminalLayerSpring?) {
    guard self.frame != frame else { return }
    let modelPosition = layer?.position
    let modelBounds = layer?.bounds
    let oldPosition = layer?.presentation()?.position ?? layer?.position
    let oldBounds = layer?.presentation()?.bounds ?? layer?.bounds
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    self.frame = frame
    layoutSubtreeIfNeeded()
    CATransaction.commit()
    guard let spring, let layer, let oldPosition, let oldBounds else { return }
    if modelPosition != layer.position {
      layer.add(
        TerminalLayerAnimation.spring(
          keyPath: "position",
          from: NSValue(point: oldPosition),
          to: NSValue(point: layer.position),
          spring: spring
        ),
        forKey: "splitTargetPosition"
      )
    }
    if modelBounds != layer.bounds {
      layer.add(
        TerminalLayerAnimation.spring(
          keyPath: "bounds",
          from: NSValue(rect: oldBounds),
          to: NSValue(rect: layer.bounds),
          spring: spring
        ),
        forKey: "splitTargetBounds"
      )
    }
  }

  func setActive(_ isActive: Bool, animated: Bool) {
    if !animated {
      wrapperView.layer?.removeAnimation(forKey: "splitTargetHover")
    }
    guard isActive != self.isActive else { return }
    self.isActive = isActive
    applyStyle(animated: animated)
    guard let layer = wrapperView.layer else { return }
    let oldTransform = layer.presentation()?.transform ?? layer.transform
    let scale = isActive ? TerminalTabSplitTargetMotion.activeScale : 1
    let newTransform = CATransform3DMakeScale(scale, scale, 1)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.transform = newTransform
    CATransaction.commit()
    guard animated else { return }
    layer.add(
      TerminalLayerAnimation.spring(
        keyPath: "transform",
        from: NSValue(caTransform3D: oldTransform),
        to: NSValue(caTransform3D: newTransform),
        spring: TerminalTabSplitTargetMotion.hoverSpring
      ),
      forKey: "splitTargetHover"
    )
  }

  func show(
    transformSpring: TerminalLayerSpring?,
    opacitySpring: TerminalLayerSpring?
  ) {
    guard let layer else { return }
    layer.removeAnimation(forKey: "splitTargetExit")
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.opacity = 1
    layer.transform = CATransform3DIdentity
    CATransaction.commit()
    let startTransform = CATransform3DMakeScale(0.5, 0.5, 1)
    if let transformSpring {
      layer.add(
        TerminalLayerAnimation.spring(
          keyPath: "transform",
          from: NSValue(caTransform3D: startTransform),
          to: NSValue(caTransform3D: CATransform3DIdentity),
          spring: transformSpring
        ),
        forKey: "splitTargetEntry"
      )
    }
    if let opacitySpring {
      layer.add(
        TerminalLayerAnimation.spring(
          keyPath: "opacity",
          from: 0,
          to: 1,
          spring: opacitySpring
        ),
        forKey: "splitTargetOpacity"
      )
    }
  }

  func hide(spring: TerminalLayerSpring?) {
    guard let layer else { return }
    let endTransform = CATransform3DMakeScale(0.5, 0.5, 1)
    let oldTransform = layer.presentation()?.transform ?? layer.transform
    let oldOpacity = layer.presentation()?.opacity ?? layer.opacity
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.opacity = 0
    layer.transform = endTransform
    CATransaction.commit()
    guard let spring else { return }
    layer.add(
      TerminalLayerAnimation.spring(
        keyPath: "transform",
        from: NSValue(caTransform3D: oldTransform),
        to: NSValue(caTransform3D: endTransform),
        spring: spring
      ),
      forKey: "splitTargetExit"
    )
    layer.add(
      TerminalLayerAnimation.spring(
        keyPath: "opacity",
        from: oldOpacity,
        to: 0,
        spring: spring
      ),
      forKey: "splitTargetOpacity"
    )
  }

  private func applyStyle(animated: Bool) {
    let color = isActive ? NSColor.controlAccentColor : NSColor.secondaryLabelColor
    NSAnimationContext.runAnimationGroup { context in
      context.duration = animated ? TerminalTabSplitTargetMotion.colorDuration : 0
      context.allowsImplicitAnimation = animated
      label.textColor = color
      iconView.contentTintColor = color
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    shadowView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    activeTintLayer.backgroundColor = NSColor.controlAccentColor.cgColor
    CATransaction.commit()
    containerView.layer?.borderWidth = 1 / (window?.backingScaleFactor ?? 1)
    containerView.layer?.borderColor = NSColor.separatorColor.cgColor
    animateLayer(
      activeTintLayer,
      keyPath: "opacity",
      value: isActive ? Float(0.12) : 0,
      animated: animated
    )
    animateLayer(
      outlineLayer,
      keyPath: "strokeColor",
      value: isActive ? color.cgColor : NSColor.separatorColor.cgColor,
      animated: animated
    )
  }

  private func animateLayer(
    _ layer: CALayer,
    keyPath: String,
    value: Any,
    animated: Bool
  ) {
    let oldValue = layer.presentation()?.value(forKeyPath: keyPath) ?? layer.value(forKeyPath: keyPath)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.setValue(value, forKeyPath: keyPath)
    CATransaction.commit()
    guard animated, let oldValue else { return }
    layer.add(
      TerminalLayerAnimation.basic(
        keyPath: keyPath,
        from: oldValue,
        to: value,
        duration: TerminalTabSplitTargetMotion.colorDuration,
        timingFunction: TerminalTabDragAnimationTiming.directManipulation
      ),
      forKey: "splitTarget\(keyPath)"
    )
  }

  private func inset(_ rect: CGRect, by amount: CGFloat) -> CGRect {
    guard rect.width > 0, rect.height > 0 else { return .zero }
    let amount = min(amount, rect.width / 2, rect.height / 2)
    return rect.insetBy(dx: amount, dy: amount)
  }
}
