import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class TerminalSidebarSelectionGlowView: NSView {
  private static let contentTopFade: CGFloat = 24

  private let shadowLayer = CAShapeLayer()
  private let shadowMaskLayer = CAShapeLayer()
  private let contentTopFadeLayer = CAGradientLayer()

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    contentTopFadeLayer.colors = [NSColor.clear.cgColor, NSColor.white.cgColor]
    contentTopFadeLayer.actions = [
      "startPoint": NSNull(),
      "endPoint": NSNull(),
      "bounds": NSNull(),
      "position": NSNull(),
    ]
    shadowLayer.fillColor = NSColor.white.cgColor
    shadowLayer.shadowOpacity = 1
    shadowLayer.shadowOffset = CGSize(
      width: SelectableRowShadowMetrics.offset.width,
      height: -SelectableRowShadowMetrics.offset.height
    )
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
    let shapePath = RoundedRectangle(
      cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
      style: .continuous
    )
    .path(in: shapeBounds)
    .cgPath
    let maskPath = CGMutablePath()
    maskPath.addRect(bounds)
    maskPath.addPath(shapePath)
    shadowLayer.frame = bounds
    shadowLayer.path = shapePath
    shadowLayer.shadowPath = shapePath
    shadowMaskLayer.frame = bounds
    shadowMaskLayer.path = maskPath
    layoutContentTopFade()
  }

  private func layoutContentTopFade() {
    guard bounds.height > 0, frame.minY < Self.contentTopFade else {
      layer?.mask = nil
      return
    }
    contentTopFadeLayer.frame = bounds
    contentTopFadeLayer.startPoint = CGPoint(x: 0.5, y: unitY(contentY: 0))
    contentTopFadeLayer.endPoint = CGPoint(x: 0.5, y: unitY(contentY: Self.contentTopFade))
    layer?.mask = contentTopFadeLayer
  }

  private func unitY(contentY: CGFloat) -> CGFloat {
    (bounds.height - (contentY - frame.minY)) / bounds.height
  }

  func update(surfaceFrame: CGRect, color: Color, alpha: CGFloat, isDark: Bool) {
    shadowLayer.shadowColor = NSColor(color).cgColor
    shadowLayer.shadowRadius = SelectableRowShadowMetrics.radius(isDark: isDark)
    frame = Self.visualFrame(for: surfaceFrame)
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
