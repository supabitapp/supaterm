import AppKit

struct TerminalTabSplitDropLayout: Equatable {
  let leftFrame: CGRect
  let rightFrame: CGRect

  init(bounds: CGRect) {
    let widthLimit = min(345, max(140, bounds.width / 3))
    let shortSide = min(widthLimit, bounds.height * 0.8 / 1.6)
    let size = CGSize(width: shortSide, height: shortSide * 1.6)
    let y = bounds.midY - size.height / 2
    leftFrame = CGRect(x: bounds.minX + 22, y: y, width: size.width, height: size.height)
    rightFrame = CGRect(
      x: bounds.maxX - 22 - size.width,
      y: y,
      width: size.width,
      height: size.height
    )
  }

  func side(at point: CGPoint) -> TerminalTabSplitSide? {
    if leftFrame.contains(point) { return .left }
    if rightFrame.contains(point) { return .right }
    return nil
  }
}

@MainActor
final class TerminalTabSplitDropOverlayView: NSView {
  private let leftTarget = TerminalTabSplitTargetView(side: .left)
  private let rightTarget = TerminalTabSplitTargetView(side: .right)
  private(set) var activeSide: TerminalTabSplitSide?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
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
    let layout = TerminalTabSplitDropLayout(bounds: bounds)
    leftTarget.frame = layout.leftFrame
    rightTarget.frame = layout.rightFrame
  }

  func present() {
    guard alphaValue == 0 else { return }
    alphaValue = 1
    leftTarget.layer?.transform = CATransform3DMakeScale(0.65, 0.65, 1)
    rightTarget.layer?.transform = CATransform3DMakeScale(0.65, 0.65, 1)
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.2
      leftTarget.animator().layer?.transform = CATransform3DIdentity
      rightTarget.animator().layer?.transform = CATransform3DIdentity
    }
  }

  func update(point: CGPoint) -> TerminalTabSplitSide? {
    let side = TerminalTabSplitDropLayout(bounds: bounds).side(at: point)
    guard side != activeSide else { return side }
    activeSide = side
    leftTarget.isActive = side == .left
    rightTarget.isActive = side == .right
    return side
  }

  func dismiss() {
    activeSide = nil
    leftTarget.isActive = false
    rightTarget.isActive = false
    alphaValue = 0
  }
}

@MainActor
private final class TerminalTabSplitTargetView: NSView {
  var isActive = false {
    didSet { applyStyle() }
  }

  private let iconView = NSImageView()
  private let label = NSTextField(labelWithString: "")
  private let outlineLayer = CAShapeLayer()

  init(side: TerminalTabSplitSide) {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 20
    layer?.addSublayer(outlineLayer)
    outlineLayer.fillColor = NSColor.clear.cgColor
    outlineLayer.lineDashPattern = [6, 6]
    outlineLayer.lineWidth = 1.5
    iconView.image = NSImage(
      systemSymbolName: side == .left ? "rectangle.lefthalf.inset.filled" : "rectangle.righthalf.inset.filled",
      accessibilityDescription: nil
    )
    iconView.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 16, weight: .semibold)
    label.stringValue = side == .left ? "Add left split" : "Add right split"
    label.font = .systemFont(ofSize: 14, weight: .semibold)
    label.alignment = .center
    addSubview(iconView)
    addSubview(label)
    applyStyle()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func layout() {
    super.layout()
    outlineLayer.frame = bounds
    outlineLayer.path = CGPath(
      roundedRect: bounds.insetBy(dx: 12, dy: 12),
      cornerWidth: 14,
      cornerHeight: 14,
      transform: nil
    )
    iconView.frame = CGRect(
      x: bounds.midX - 8,
      y: bounds.midY + 10,
      width: 16,
      height: 16
    )
    label.frame = CGRect(
      x: 4,
      y: bounds.midY - 26,
      width: bounds.width - 8,
      height: 20
    )
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    applyStyle()
  }

  private func applyStyle() {
    let color = isActive ? NSColor.controlAccentColor : NSColor.secondaryLabelColor
    iconView.contentTintColor = color
    label.textColor = color
    layer?.backgroundColor =
      NSColor.windowBackgroundColor.withAlphaComponent(
        isActive ? 0.94 : 0.82
      ).cgColor
    outlineLayer.strokeColor = color.withAlphaComponent(isActive ? 0.8 : 0.32).cgColor
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = isActive ? 0.2 : 0.1
    layer?.shadowRadius = isActive ? 16 : 8
    layer?.shadowOffset = .zero
  }
}
