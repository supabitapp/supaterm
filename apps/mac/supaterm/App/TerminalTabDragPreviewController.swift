import AppKit
import QuartzCore

enum TerminalTabDragAnimationTiming {
  static var directManipulation: CAMediaTimingFunction {
    CAMediaTimingFunction(controlPoints: 0.215, 0.61, 0.355, 1)
  }
}

struct TerminalTabDragPreviewLayout {
  private static let previewWidth: CGFloat = 210
  private static let fallbackHeight: CGFloat = 138.6
  private static let contentInset: CGFloat = 2
  private static let windowContentLeadingInset: CGFloat = 45
  private static let sourceContentVerticalInset: CGFloat = 80

  static func frame(
    for sourceSize: CGSize?,
    at screenPoint: CGPoint
  ) -> CGRect {
    let size = previewSize(for: sourceSize)
    return CGRect(
      x: screenPoint.x - size.width / 2,
      y: screenPoint.y - size.height / 2,
      width: size.width,
      height: size.height
    )
  }

  static func sourceContentSize(for windowFrame: CGRect) -> CGSize {
    CGSize(
      width: windowFrame.width,
      height: max(0, windowFrame.height - sourceContentVerticalInset)
    )
  }

  static func snapshotFrame(for imageSize: CGSize?, in bounds: CGRect) -> CGRect {
    guard
      let imageSize,
      imageSize.width.isFinite,
      imageSize.height.isFinite,
      imageSize.width > 0,
      imageSize.height > 0,
      bounds.width.isFinite,
      bounds.width > 0
    else { return bounds }
    let scale = bounds.width / imageSize.width
    let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
    return CGRect(
      x: bounds.minX,
      y: bounds.maxY - size.height,
      width: size.width,
      height: size.height
    )
  }

  static func contentFrame(for type: TerminalTabDragPreviewType, in bounds: CGRect) -> CGRect {
    let surfaceFrame = contentHostFrame(in: bounds)
    switch type {
    case .window:
      let minX = min(surfaceFrame.maxX, surfaceFrame.minX + windowContentLeadingInset)
      return CGRect(
        x: minX,
        y: surfaceFrame.minY,
        width: max(0, surfaceFrame.maxX - minX),
        height: surfaceFrame.height
      )
    case .contentPane:
      return surfaceFrame
    }
  }

  static func silhouettePath(for type: TerminalTabDragPreviewType, in bounds: CGRect) -> CGPath {
    let surfaceFrame = contentHostFrame(in: bounds)
    let path = CGMutablePath()
    path.addRoundedRect(
      in: CGRect(x: surfaceFrame.minX + 2, y: surfaceFrame.minY + 12, width: 40, height: 8),
      cornerWidth: 2.5,
      cornerHeight: 2.5
    )
    path.addRoundedRect(
      in: contentFrame(for: type, in: bounds),
      cornerWidth: 2,
      cornerHeight: 2
    )
    return path
  }

  static func windowControlsFrame(in bounds: CGRect) -> CGRect {
    CGRect(x: bounds.minX + 6, y: bounds.maxY - 9, width: 16, height: 4)
  }

  static func contentHostFrame(in bounds: CGRect) -> CGRect {
    bounds.insetBy(dx: contentInset, dy: contentInset)
  }

  private static func previewSize(for sourceSize: CGSize?) -> CGSize {
    guard
      let sourceSize,
      sourceSize.width.isFinite,
      sourceSize.height.isFinite,
      sourceSize.width > 0
    else { return fallbackSize }
    let height = sourceSize.height * previewWidth / sourceSize.width
    guard height.isFinite, height > 0 else { return fallbackSize }
    return CGSize(width: previewWidth, height: height)
  }

  private static var fallbackSize: CGSize {
    CGSize(width: previewWidth, height: fallbackHeight)
  }
}

@MainActor
protocol TerminalTabDragPreviewPresenting: AnyObject {
  func show(image: NSImage?, frame: CGRect, type: TerminalTabDragPreviewType) -> CGRect
  func update(image: NSImage?)
  func transition(to type: TerminalTabDragPreviewType) -> Bool
  func hide()
}

@MainActor
final class TerminalTabDragPreviewController: TerminalTabDragPreviewPresenting {
  private let snapshotView = TerminalTabDragSnapshotView()
  private let reduceMotion: () -> Bool
  private var panel: TerminalTabDragPreviewPanel?

  init(
    reduceMotion: @escaping () -> Bool = {
      NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }
  ) {
    self.reduceMotion = reduceMotion
  }

  func show(
    image: NSImage?,
    frame: CGRect,
    type: TerminalTabDragPreviewType
  ) -> CGRect {
    snapshotView.image = image?.isValid == true ? image : nil
    let panel = panel ?? TerminalTabDragPreviewPanel(contentView: snapshotView)
    self.panel = panel
    panel.setFrame(frame, display: false)
    _ = snapshotView.setPreviewType(type, animated: false)
    panel.orderFrontRegardless()
    return panel.frame
  }

  func transition(to type: TerminalTabDragPreviewType) -> Bool {
    snapshotView.setPreviewType(
      type,
      animated: panel?.isVisible == true && !reduceMotion()
    )
  }

  func update(image: NSImage?) {
    snapshotView.image = image?.isValid == true ? image : nil
  }

  func hide() {
    panel?.orderOut(nil)
    snapshotView.image = nil
  }
}

@MainActor
private final class TerminalTabDragSnapshotView: NSView {
  private static let transitionDuration: TimeInterval = 0.2

  private let silhouetteLayer = CAShapeLayer()
  private let effectView = NSVisualEffectView()
  private let windowControlsView = TerminalTabDragWindowControlsView()
  private let contentView = TerminalTabDragFlippedView()
  private let imageContainerView = NSView()
  private let imageView = NSImageView()
  private(set) var previewType = TerminalTabDragPreviewType.window

  var image: NSImage? {
    didSet {
      imageView.image = image
      needsLayout = true
    }
  }

  override var wantsUpdateLayer: Bool { true }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.masksToBounds = false
    layer?.cornerRadius = 4
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.38
    layer?.shadowRadius = 14
    layer?.shadowOffset = CGSize(width: 0, height: 1.5)
    silhouetteLayer.fillColor = NSColor.windowBackgroundColor.cgColor
    silhouetteLayer.shadowColor = NSColor.black.cgColor
    silhouetteLayer.shadowOpacity = 0.25
    silhouetteLayer.shadowRadius = 1
    silhouetteLayer.shadowOffset = CGSize(width: 0, height: 0.5)
    effectView.blendingMode = .behindWindow
    effectView.material = .hudWindow
    effectView.state = .active
    effectView.wantsLayer = true
    effectView.layer?.cornerRadius = 4
    effectView.layer?.masksToBounds = true
    addSubview(effectView)
    effectView.addSubview(windowControlsView)
    contentView.wantsLayer = true
    contentView.layer?.masksToBounds = false
    effectView.addSubview(contentView)
    contentView.layer?.addSublayer(silhouetteLayer)
    imageContainerView.wantsLayer = true
    imageContainerView.layer?.cornerRadius = 2
    imageContainerView.layer?.masksToBounds = true
    imageView.imageScaling = .scaleAxesIndependently
    imageContainerView.addSubview(imageView)
    contentView.addSubview(imageContainerView)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func layout() {
    super.layout()
    applyLayout()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  override func updateLayer() {
    layer?.borderWidth = 1 / (window?.backingScaleFactor ?? 1)
    layer?.borderColor = NSColor.separatorColor.cgColor
    silhouetteLayer.fillColor = NSColor.windowBackgroundColor.cgColor
    imageContainerView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
  }

  func setPreviewType(
    _ type: TerminalTabDragPreviewType,
    animated: Bool
  ) -> Bool {
    guard type != previewType else { return false }
    layoutSubtreeIfNeeded()
    let oldPath = silhouetteLayer.presentation()?.path ?? silhouetteLayer.path
    let oldShadowPath = silhouetteLayer.presentation()?.shadowPath ?? silhouetteLayer.shadowPath
    let oldContainerPosition =
      imageContainerView.layer?.presentation()?.position ?? imageContainerView.layer?.position
    let oldContainerBounds =
      imageContainerView.layer?.presentation()?.bounds ?? imageContainerView.layer?.bounds
    let oldImagePosition = imageView.layer?.presentation()?.position ?? imageView.layer?.position
    let oldImageBounds = imageView.layer?.presentation()?.bounds ?? imageView.layer?.bounds
    removeMorphAnimations()
    previewType = type
    applyLayout()
    guard animated else { return true }
    addAnimation(
      to: silhouetteLayer,
      key: "previewPath",
      keyPath: "path",
      from: oldPath,
      to: silhouetteLayer.path
    )
    addAnimation(
      to: silhouetteLayer,
      key: "previewShadowPath",
      keyPath: "shadowPath",
      from: oldShadowPath,
      to: silhouetteLayer.shadowPath
    )
    if let layer = imageContainerView.layer {
      addAnimation(
        to: layer,
        key: "previewPosition",
        keyPath: "position",
        from: oldContainerPosition.map(NSValue.init(point:)),
        to: NSValue(point: layer.position)
      )
      addAnimation(
        to: layer,
        key: "previewBounds",
        keyPath: "bounds",
        from: oldContainerBounds.map(NSValue.init(rect:)),
        to: NSValue(rect: layer.bounds)
      )
    }
    if let layer = imageView.layer {
      addAnimation(
        to: layer,
        key: "previewPosition",
        keyPath: "position",
        from: oldImagePosition.map(NSValue.init(point:)),
        to: NSValue(point: layer.position)
      )
      addAnimation(
        to: layer,
        key: "previewBounds",
        keyPath: "bounds",
        from: oldImageBounds.map(NSValue.init(rect:)),
        to: NSValue(rect: layer.bounds)
      )
    }
    return true
  }

  private func applyLayout() {
    let contentHostFrame = TerminalTabDragPreviewLayout.contentHostFrame(in: bounds)
    var contentTransform = CGAffineTransform(
      translationX: -contentHostFrame.minX,
      y: -contentHostFrame.minY
    )
    let rootPath = TerminalTabDragPreviewLayout.silhouettePath(for: previewType, in: bounds)
    let path = rootPath.copy(using: &contentTransform)
    let contentFrame = TerminalTabDragPreviewLayout.contentFrame(for: previewType, in: bounds)
      .offsetBy(dx: -contentHostFrame.minX, dy: -contentHostFrame.minY)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    contentView.frame = contentHostFrame
    silhouetteLayer.frame = contentView.bounds
    silhouetteLayer.path = path
    silhouetteLayer.shadowPath = path
    layer?.shadowPath = rootPath
    effectView.frame = bounds
    windowControlsView.frame = TerminalTabDragPreviewLayout.windowControlsFrame(in: effectView.bounds)
    imageContainerView.frame = contentFrame
    imageView.frame = TerminalTabDragPreviewLayout.snapshotFrame(
      for: image?.size,
      in: imageContainerView.bounds
    )
    CATransaction.commit()
  }

  private func removeMorphAnimations() {
    silhouetteLayer.removeAnimation(forKey: "previewPath")
    silhouetteLayer.removeAnimation(forKey: "previewShadowPath")
    imageContainerView.layer?.removeAnimation(forKey: "previewPosition")
    imageContainerView.layer?.removeAnimation(forKey: "previewBounds")
    imageView.layer?.removeAnimation(forKey: "previewPosition")
    imageView.layer?.removeAnimation(forKey: "previewBounds")
  }

  private func addAnimation(
    to layer: CALayer,
    key: String,
    keyPath: String,
    from: Any?,
    to: Any?
  ) {
    guard let from, let to else { return }
    let animation = CABasicAnimation(keyPath: keyPath)
    animation.fromValue = from
    animation.toValue = to
    animation.duration = Self.transitionDuration
    animation.timingFunction = TerminalTabDragAnimationTiming.directManipulation
    layer.add(animation, forKey: key)
  }
}

@MainActor
private final class TerminalTabDragFlippedView: NSView {
  override var isFlipped: Bool { true }
}

@MainActor
private final class TerminalTabDragWindowControlsView: NSView {
  private let controlLayers: [CALayer] = [
    NSColor(red: 254 / 255, green: 95 / 255, blue: 88 / 255, alpha: 1),
    NSColor(red: 254 / 255, green: 188 / 255, blue: 46 / 255, alpha: 1),
    NSColor(red: 43 / 255, green: 200 / 255, blue: 64 / 255, alpha: 1),
  ].map { color in
    let layer = CALayer()
    layer.backgroundColor = color.cgColor
    layer.cornerRadius = 2
    return layer
  }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    controlLayers.forEach { layer?.addSublayer($0) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func layout() {
    super.layout()
    for (index, layer) in controlLayers.enumerated() {
      layer.frame = CGRect(x: CGFloat(index) * 6, y: 0, width: 4, height: 4)
    }
  }
}

@MainActor
private final class TerminalTabDragPreviewPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  init(contentView: NSView) {
    super.init(
      contentRect: .zero,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.contentView = contentView
    animationBehavior = .none
    backgroundColor = .clear
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    hasShadow = false
    hidesOnDeactivate = false
    ignoresMouseEvents = true
    isFloatingPanel = true
    isOpaque = false
    level = .popUpMenu
    contentView.wantsLayer = true
    contentView.layer?.masksToBounds = false
  }
}
