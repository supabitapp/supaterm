import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

enum TerminalHorizontalTabTypography {
  static var titleFont: NSFont { .systemFont(ofSize: 12, weight: .medium) }
  static var groupTitleFont: NSFont { .systemFont(ofSize: 12, weight: .semibold) }
  static var subtitleFont: NSFont { .systemFont(ofSize: 10, weight: .regular) }
}

struct TerminalHorizontalTabItemPresentation: Equatable {
  enum Content: Equatable {
    case group(
      id: TerminalTabGroupID,
      title: String,
      color: ThemeTint,
      iconURL: URL?,
      isCollapsed: Bool,
      hasUnread: Bool,
      tabCount: Int
    )
    case tab(
      id: TerminalTabID,
      title: String,
      subtitle: String?,
      accessibilityTitle: String,
      agentStatus: TerminalHostState.TabAgentStatus?,
      trailingStatus: TerminalHorizontalTabTrailingStatus?
    )
  }

  let content: Content
  let selection: SelectableRowSelection
  let selectedTint: ThemeTint?
  let selectedTopExtension: CGFloat

  init(
    content: Content,
    selection: SelectableRowSelection,
    selectedTint: ThemeTint?,
    selectedTopExtension: CGFloat
  ) {
    self.content = content
    self.selection = selection
    self.selectedTint = selectedTint
    self.selectedTopExtension = selectedTopExtension
  }

  init(
    content: Content,
    isSelected: Bool,
    selectedTint: ThemeTint?,
    selectedTopExtension: CGFloat
  ) {
    self.init(
      content: content,
      selection: isSelected ? .primary : .none,
      selectedTint: selectedTint,
      selectedTopExtension: selectedTopExtension
    )
  }

  var isSelected: Bool { selection != .none }

  var accessibilityIdentifier: String {
    switch content {
    case .group(let id, _, _, _, _, _, _):
      HorizontalTabAccessibilityID.group(id)
    case .tab(let id, _, _, _, _, _):
      HorizontalTabAccessibilityID.tab(id)
    }
  }

  var accessibilityLabel: String {
    switch content {
    case .group(_, let title, let color, _, _, let hasUnread, let tabCount):
      let label = "\(title), \(color.displayName) group, \(tabCount) tabs"
      return hasUnread ? "\(label), unread activity" : label
    case .tab(_, _, _, let title, let agentStatus, let trailingStatus):
      return
        ([title]
        + [
          agentStatus?.horizontalAccessibilityDescription, trailingStatus?.accessibilityDescription,
        ]
        .compactMap { $0 })
        .joined(separator: ", ")
    }
  }
}

enum HorizontalTabAccessibilityID {
  static func group(_ groupID: TerminalTabGroupID) -> String {
    "horizontal-tabs.group.\(groupID.rawValue.uuidString.lowercased())"
  }

  static func groupNewTab(_ groupID: TerminalTabGroupID) -> String {
    "\(group(groupID)).new-tab"
  }

  static func tab(_ tabID: TerminalTabID) -> String {
    "horizontal-tabs.tab.\(tabID.rawValue.uuidString.lowercased())"
  }

  static func tabClose(_ tabID: TerminalTabID) -> String {
    "\(tab(tabID)).close"
  }
}

struct HorizontalTabGroupChrome: Equatable {
  let color: ThemeTint
  let isCollapsed: Bool
  let headerFrame: CGRect
  let firstChildFrame: CGRect?
  let isFirstChildSelected: Bool
}

@MainActor
final class TerminalHorizontalTabStripView: NSView, NSDraggingSource {
  weak var controller: TerminalHorizontalTabStripController?

  override var isFlipped: Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let localPoint = localHitTestPoint(point)
    return controller?.pointerTarget(at: localPoint) ?? super.hitTest(point)
  }

  override func mouseDown(with event: NSEvent) {
    window?.performDrag(with: event)
  }

  override func layout() {
    super.layout()
    controller?.layoutDidChange()
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    controller?.draggingUpdated(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    controller?.draggingUpdated(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    controller?.draggingExited()
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    controller?.destinationDraggingEnded()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return controller?.prepareForDragOperation(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    controller?.performDragOperation(sender) == true
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    controller?.sourceOperationMask() ?? []
  }

  func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    controller?.sourceSessionMoved(to: screenPoint)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    controller?.sourceSessionEnded(operation: operation)
  }
}

@MainActor
final class TerminalHorizontalTabControlButton: NSButton {
  var isMenuOpen = false {
    didSet { updateAppearance() }
  }

  private var isHovered = false
  private var isPressed = false
  private var palette: Palette?
  private var trackingArea: NSTrackingArea?

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    if let trackingArea { removeTrackingArea(trackingArea) }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited],
      owner: self
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
    updateAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    updateAppearance()
  }

  override func highlight(_ flag: Bool) {
    super.highlight(flag)
    isPressed = flag
    updateAppearance()
  }

  func apply(palette: Palette) {
    self.palette = palette
    updateAppearance()
  }

  private func updateAppearance() {
    guard let palette else { return }
    wantsLayer = true
    layer?.cornerRadius = 10
    let fill: NSColor =
      if isPressed {
        NSColor(palette.sidebarControlPressedFill)
      } else if isMenuOpen || isHovered {
        NSColor(palette.sidebarControlHoverFill)
      } else {
        .clear
      }
    layer?.backgroundColor = fill.cgColor
    contentTintColor = NSColor(
      isMenuOpen || isHovered ? palette.primaryText : palette.secondaryText
    )
  }
}

@MainActor
final class TerminalHorizontalTabGroupCloseButton: NSButton {
  var onClose: (() -> Void)?

  private let separatorLayer = CALayer()
  private var isHovered = false
  private var palette: Palette?
  private var trackingArea: NSTrackingArea?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.masksToBounds = false
    layer?.addSublayer(separatorLayer)
    bezelStyle = .inline
    isBordered = false
    image = NSImage(systemSymbolName: "xmark", accessibilityDescription: nil)
    imagePosition = .imageOnly
    symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .bold)
    target = self
    action = #selector(close)
    toolTip = "Close this Group"
    setAccessibilityElement(true)
    setAccessibilityLabel("Close Group")
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func updateTrackingAreas() {
    if let trackingArea { removeTrackingArea(trackingArea) }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited],
      owner: self
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
    updateAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    updateAppearance()
  }

  override func highlight(_ flag: Bool) {
    super.highlight(flag)
    updateAppearance()
  }

  override func layout() {
    super.layout()
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    separatorLayer.frame = CGRect(
      x: -2.5,
      y: bounds.midY - 7.5,
      width: 1 / scale,
      height: 15
    )
  }

  func apply(palette: Palette) {
    self.palette = palette
    updateAppearance()
  }

  private func updateAppearance() {
    guard let palette else { return }
    layer?.cornerRadius = 4
    layer?.backgroundColor =
      isHovered || isHighlighted
      ? NSColor(palette.sidebarControlHoverFill).cgColor
      : NSColor.clear.cgColor
    contentTintColor = NSColor(
      isHovered || isHighlighted ? palette.primaryText : palette.secondaryText
    )
    separatorLayer.backgroundColor = NSColor(palette.sidebarSeparator).cgColor
    separatorLayer.opacity = isHovered || isHighlighted ? 0 : 1
  }

  @objc private func close() {
    onClose?()
  }
}

@MainActor
final class HorizontalTabSectionSeparator: NSView {
  private let separatorLayer = CALayer()

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(separatorLayer)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    let width = 1 / scale
    separatorLayer.frame = CGRect(
      x: bounds.midX - width / 2,
      y: bounds.midY - 8,
      width: width,
      height: 16
    )
  }

  func apply(palette: Palette) {
    separatorLayer.backgroundColor = NSColor(palette.sidebarSeparator).cgColor
  }
}

@MainActor
final class TerminalHorizontalTabGroupView: NSView {
  private let bridgeLayer = CAShapeLayer()
  private let collapsedLayer = CAShapeLayer()
  private let expandedLayer = CAShapeLayer()
  private let expandedMaskLayer = CAShapeLayer()
  private let innerShadowLayer = CAShapeLayer()
  private let titleSeparatorLayer = CALayer()
  private var presentation: HorizontalTabGroupChrome?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.masksToBounds = false
    layer?.addSublayer(expandedLayer)
    layer?.addSublayer(collapsedLayer)
    layer?.addSublayer(innerShadowLayer)
    layer?.addSublayer(bridgeLayer)
    layer?.addSublayer(titleSeparatorLayer)
    expandedLayer.mask = expandedMaskLayer
    expandedLayer.fillColor = NSColor.clear.cgColor
    collapsedLayer.fillColor = NSColor.clear.cgColor
    innerShadowLayer.fillRule = .evenOdd
    bridgeLayer.fillColor = NSColor.clear.cgColor
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    guard let presentation else { return }
    let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
    let lineWidth = 1 / scale
    let shapeBounds = bounds.insetBy(dx: lineWidth / 2, dy: lineWidth / 2)
    let expandedPath = RoundedRectangle(cornerRadius: 10, style: .continuous)
      .path(in: shapeBounds)
      .cgPath
    let collapsedBounds = CGRect(
      x: shapeBounds.minX,
      y: shapeBounds.minY,
      width: min(
        shapeBounds.width,
        presentation.headerFrame.maxX
          + TerminalHorizontalTabLayoutMetrics.groupSurfaceHorizontalInset
          - lineWidth / 2
      ),
      height: shapeBounds.height
    )
    let collapsedPath = RoundedRectangle(cornerRadius: 8, style: .continuous)
      .path(in: collapsedBounds)
      .cgPath
    expandedLayer.frame = bounds
    expandedLayer.path = expandedPath
    expandedLayer.lineWidth = lineWidth
    collapsedLayer.frame = bounds
    collapsedLayer.path = collapsedPath
    collapsedLayer.lineWidth = lineWidth
    expandedMaskLayer.frame = bounds
    expandedMaskLayer.path = expandedPath
    expandedMaskLayer.fillColor = NSColor.white.cgColor
    innerShadowLayer.frame = bounds
    let shadowPath = CGMutablePath()
    shadowPath.addRect(bounds.insetBy(dx: -8, dy: -8))
    shadowPath.addPath(expandedPath)
    innerShadowLayer.path = shadowPath
    innerShadowLayer.shadowPath = expandedPath
    let headerFrame = presentation.headerFrame
    titleSeparatorLayer.frame = CGRect(
      x: headerFrame.maxX + 1.5,
      y: bounds.midY - 7.5,
      width: lineWidth,
      height: 15
    )
    if presentation.isFirstChildSelected, let firstChildFrame = presentation.firstChildFrame {
      let bridgeRect = CGRect(
        x: headerFrame.maxX - 2,
        y: firstChildFrame.minY,
        width: max(0, firstChildFrame.minX - headerFrame.maxX + 4),
        height: firstChildFrame.height + 5
      )
      bridgeLayer.frame = bounds
      bridgeLayer.path = CGPath(rect: bridgeRect, transform: nil)
    } else {
      bridgeLayer.path = nil
    }
  }

  func apply(
    _ presentation: HorizontalTabGroupChrome,
    palette: Palette,
    reduceMotion: Bool
  ) {
    let expansionChanged =
      self.presentation.map {
        $0.isCollapsed != presentation.isCollapsed
      } == true
    self.presentation = presentation
    let color = presentation.color.sidebarNSColor(palette: palette)
    let fill =
      presentation.color == .neutral
      ? NSColor.clear
      : color.withAlphaComponent(palette.isDark ? 0.20 : 0.12)
    let stroke =
      presentation.color == .neutral
      ? NSColor.clear
      : color.withAlphaComponent(palette.isDark ? 0.25 : 0.15)
    collapsedLayer.fillColor = fill.cgColor
    collapsedLayer.strokeColor = stroke.cgColor
    expandedLayer.fillColor = fill.cgColor
    expandedLayer.strokeColor = stroke.cgColor
    innerShadowLayer.fillColor = NSColor.black.cgColor
    innerShadowLayer.shadowColor = NSColor.black.cgColor
    innerShadowLayer.shadowOpacity = palette.isDark ? 0.28 : 0.18
    innerShadowLayer.shadowRadius = 2
    innerShadowLayer.shadowOffset = CGSize(width: 0, height: -1)
    titleSeparatorLayer.backgroundColor = stroke.cgColor
    bridgeLayer.fillColor = selectedFill(palette: palette, tint: color).cgColor
    setVisible(
      collapsedLayer,
      presentation.isCollapsed,
      animated: expansionChanged,
      reduceMotion: reduceMotion
    )
    setVisible(
      expandedLayer,
      !presentation.isCollapsed,
      animated: expansionChanged,
      reduceMotion: reduceMotion
    )
    setVisible(
      innerShadowLayer,
      !presentation.isCollapsed && presentation.color != .neutral,
      animated: expansionChanged,
      reduceMotion: reduceMotion
    )
    setVisible(
      titleSeparatorLayer,
      !presentation.isCollapsed,
      animated: expansionChanged,
      reduceMotion: reduceMotion
    )
    bridgeLayer.isHidden = presentation.isCollapsed || !presentation.isFirstChildSelected
    needsLayout = true
  }

  private func setVisible(
    _ layer: CALayer,
    _ isVisible: Bool,
    animated: Bool,
    reduceMotion: Bool
  ) {
    let target: Float = isVisible ? 1 : 0
    if reduceMotion || !animated {
      layer.removeAnimation(forKey: "horizontalGroupVisibility")
      layer.opacity = target
      return
    }
    let old = layer.presentation()?.opacity ?? layer.opacity
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.opacity = target
    CATransaction.commit()
    let animation = CASpringAnimation(keyPath: "opacity")
    animation.fromValue = old
    animation.toValue = target
    animation.mass = 1
    animation.stiffness = pow(2 * Double.pi / 0.3, 2)
    animation.damping = 4 * Double.pi * 0.82 / 0.3
    animation.duration = animation.settlingDuration
    layer.add(animation, forKey: "horizontalGroupVisibility")
  }
}

@MainActor
final class TerminalHorizontalTabBottomView: NSView {
  struct Style {
    let palette: Palette
    let tint: NSColor?
    let hoverFill: NSColor?
    let selection: SelectableRowSelection
    let isHovered: Bool
    let selectedTopExtension: CGFloat
    let reduceMotion: Bool
  }

  private let fillLayer = CAShapeLayer()
  private let shadowLayer = CAShapeLayer()
  private let shadowMaskLayer = CAShapeLayer()
  private var fillAnimationID = UUID()
  private var selection = SelectableRowSelection.none
  private var selectedTopExtension: CGFloat = 0

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.masksToBounds = false
    layer?.addSublayer(shadowLayer)
    layer?.addSublayer(fillLayer)
    shadowLayer.mask = shadowMaskLayer
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    fillLayer.frame = bounds
    shadowLayer.frame = bounds
    shadowMaskLayer.frame = bounds
    let path = selection == .primary ? selectedPath() : restingPath()
    fillLayer.path = path
    shadowLayer.path = path
    shadowLayer.shadowPath = path
    shadowMaskLayer.path = CGPath(
      rect: CGRect(
        x: -16,
        y: bounds.maxY - 2,
        width: bounds.width + 32,
        height: 10
      ),
      transform: nil
    )
  }

  func apply(_ style: Style) {
    selection = style.selection
    selectedTopExtension = style.selectedTopExtension == 2 ? 2 : 0
    let fill: NSColor =
      if style.selection != .none {
        selectedFill(
          palette: style.palette,
          tint: style.tint ?? NSColor(style.palette.accent)
        )
      } else if style.isHovered {
        style.hoverFill
          ?? NSColor(style.palette.primaryText).withAlphaComponent(
            style.palette.isDark ? 0.20 : 0.12
          )
      } else {
        .clear
      }
    applyFill(fill.cgColor, reduceMotion: style.reduceMotion)
    shadowLayer.fillColor = fill.cgColor
    shadowLayer.shadowColor = NSColor.black.cgColor
    shadowLayer.shadowOpacity =
      style.selection == .primary ? (style.palette.isDark ? 0.28 : 0.18) : 0
    shadowLayer.shadowRadius = 3
    shadowLayer.shadowOffset = CGSize(width: 0, height: 1)
    needsLayout = true
  }

  func animateSelectedEntrance(reduceMotion: Bool) {
    guard selection == .primary, selectedTopExtension > 0 else { return }
    if reduceMotion {
      fillLayer.removeAnimation(forKey: "horizontalTabSelectedEntrance")
      shadowLayer.removeAnimation(forKey: "horizontalTabSelectedEntrance")
      return
    }
    for layer in [fillLayer, shadowLayer] {
      let animation = CASpringAnimation(keyPath: "position.y")
      animation.fromValue = layer.position.y + selectedTopExtension
      animation.toValue = layer.position.y
      animation.mass = 1
      animation.stiffness = pow(2 * Double.pi / 0.05, 2)
      animation.damping = 4 * Double.pi / 0.05
      animation.duration = animation.settlingDuration
      layer.add(animation, forKey: "horizontalTabSelectedEntrance")
    }
  }

  private func applyFill(_ color: CGColor, reduceMotion: Bool) {
    fillAnimationID = UUID()
    let animationID = fillAnimationID
    let oldColor = fillLayer.presentation()?.fillColor ?? fillLayer.fillColor
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fillLayer.fillColor = color
    CATransaction.commit()
    guard !reduceMotion else {
      fillLayer.removeAllAnimations()
      return
    }
    let animation = CABasicAnimation(keyPath: "fillColor")
    animation.fromValue = oldColor
    animation.toValue = color
    animation.duration = 0.15
    animation.timingFunction = TerminalHorizontalTabMotion.ordinaryTimingFunction
    let key = "horizontalTabFill-\(animationID.uuidString)"
    fillLayer.add(animation, forKey: key)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
      guard let self, fillAnimationID == animationID else { return }
      fillLayer.removeAnimation(forKey: key)
    }
  }

  private func restingPath() -> CGPath {
    CGPath(
      roundedRect: bounds,
      cornerWidth: 7,
      cornerHeight: 7,
      transform: nil
    )
  }

  private func selectedPath() -> CGPath {
    let path = CGMutablePath()
    let left: CGFloat = -15
    let right = bounds.maxX + 15
    let top = bounds.minY - selectedTopExtension
    let bottom = bounds.maxY + 5
    let radius: CGFloat = 7
    path.move(to: CGPoint(x: left, y: bottom))
    path.addCurve(
      to: CGPoint(x: bounds.minX, y: bounds.maxY - 1),
      control1: CGPoint(x: left + 9, y: bottom),
      control2: CGPoint(x: bounds.minX - 5, y: bounds.maxY - 1)
    )
    path.addLine(to: CGPoint(x: bounds.minX, y: top + radius))
    path.addQuadCurve(
      to: CGPoint(x: bounds.minX + radius, y: top),
      control: CGPoint(x: bounds.minX, y: top)
    )
    path.addLine(to: CGPoint(x: bounds.maxX - radius, y: top))
    path.addQuadCurve(
      to: CGPoint(x: bounds.maxX, y: top + radius),
      control: CGPoint(x: bounds.maxX, y: top)
    )
    path.addLine(to: CGPoint(x: bounds.maxX, y: bounds.maxY - 1))
    path.addCurve(
      to: CGPoint(x: right, y: bottom),
      control1: CGPoint(x: bounds.maxX + 5, y: bounds.maxY - 1),
      control2: CGPoint(x: right - 9, y: bottom)
    )
    path.closeSubpath()
    return path
  }
}

@MainActor
final class TerminalHorizontalTabGroupIconView: NSView {
  private let fallbackLayer = CAShapeLayer()
  private let imageView = NSImageView()
  private var renderedURL: URL?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(fallbackLayer)
    imageView.imageScaling = .scaleProportionallyDown
    imageView.wantsLayer = true
    imageView.layer?.cornerRadius = 3
    imageView.layer?.masksToBounds = true
    imageView.setAccessibilityElement(false)
    addSubview(imageView)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var isFlipped: Bool { true }

  override func layout() {
    super.layout()
    imageView.frame = bounds.insetBy(dx: 1, dy: 1)
    fallbackLayer.frame = bounds
    fallbackLayer.path = CGPath(
      ellipseIn: CGRect(x: bounds.midX - 4, y: bounds.midY - 4, width: 8, height: 8),
      transform: nil
    )
  }

  func apply(iconURL: URL?, color: NSColor) {
    if renderedURL != iconURL {
      renderedURL = iconURL
      imageView.image = iconURL.flatMap(NSImage.init(contentsOf:))
    }
    fallbackLayer.fillColor = color.cgColor
    fallbackLayer.isHidden = imageView.image != nil
    imageView.isHidden = imageView.image == nil
  }
}

enum TerminalHorizontalTabMotion {
  static let ordinaryTimingFunction = CAMediaTimingFunction(
    controlPoints: 0.16,
    1,
    0.3,
    1
  )
}

private func selectedFill(palette: Palette, tint: NSColor) -> NSColor {
  let base = NSColor(palette.selectedFill)
  return base.blended(
    withFraction: palette.isDark ? 0.36 : 0.12,
    of: tint
  ) ?? base
}

extension NSView {
  func localHitTestPoint(_ point: NSPoint) -> NSPoint {
    superview.map { convert(point, from: $0) } ?? point
  }
}
