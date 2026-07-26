import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class TerminalSidebarSelectionGlowView: NSView {
  private let shadowLayer = CAShapeLayer()
  private let shadowMaskLayer = CAShapeLayer()

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    shadowLayer.fillColor = NSColor.white.cgColor
    shadowLayer.shadowOffset = .zero
    shadowLayer.shadowOpacity = 1
    shadowLayer.shadowRadius = SelectableRowShadowMetrics.radius
    shadowMaskLayer.fillColor = NSColor.white.cgColor
    shadowMaskLayer.fillRule = .evenOdd
    shadowLayer.mask = shadowMaskLayer
    layer?.addSublayer(shadowLayer)
    isHidden = true
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    let shapeBounds = bounds.insetBy(
      dx: SelectableRowShadowMetrics.visualOutset,
      dy: SelectableRowShadowMetrics.visualOutset
    )
    let shapePath = CGPath(
      roundedRect: shapeBounds,
      cornerWidth: TerminalSidebarLayout.tabRowCornerRadius,
      cornerHeight: TerminalSidebarLayout.tabRowCornerRadius,
      transform: nil
    )
    let maskPath = CGMutablePath()
    maskPath.addRect(bounds)
    maskPath.addPath(shapePath)
    shadowLayer.frame = bounds
    shadowLayer.path = shapePath
    shadowLayer.shadowPath = shapePath
    shadowMaskLayer.frame = bounds
    shadowMaskLayer.path = maskPath
  }

  func update(itemFrame: CGRect, color: Color, alpha: CGFloat) {
    shadowLayer.shadowColor = NSColor(color).cgColor
    frame = Self.visualFrame(for: itemFrame)
    alphaValue = alpha
    isHidden = false
    needsLayout = true
  }

  static func visualFrame(for itemFrame: CGRect) -> CGRect {
    itemFrame.insetBy(
      dx: -SelectableRowShadowMetrics.visualOutset,
      dy: -SelectableRowShadowMetrics.visualOutset
    )
  }
}
