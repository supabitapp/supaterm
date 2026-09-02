import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

@MainActor
final class TerminalSidebarSelectionGlowView: NSView {
  struct Style {
    let surfaceColor: Color
    let shadowColor: Color
    let edgeStrongColor: Color
    let edgeWeakColor: Color
    let isDark: Bool

    static func resolve(palette: Palette) -> Self {
      Self(
        surfaceColor: palette.selectableRow.primarySelectionFill,
        shadowColor: palette.selectableRow.shadow,
        edgeStrongColor: palette.sidebarTabRowSelectedEdgeStrong,
        edgeWeakColor: palette.sidebarTabRowSelectedEdgeWeak,
        isDark: palette.isDark
      )
    }
  }

  private static let contentTopFade: CGFloat = 24

  private let shadowLayer = CAShapeLayer()
  private let edgeLayer = CAGradientLayer()
  private let edgeMaskLayer = CAShapeLayer()
  private let contentTopFadeLayer = CAGradientLayer()
  private var fadesAtContentTop = true

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
    shadowLayer.shadowOpacity = 1
    shadowLayer.shadowOffset = CGSize(
      width: SelectableRowShadowMetrics.offset.width,
      height: -SelectableRowShadowMetrics.offset.height
    )
    edgeLayer.locations = [0, 0.1, 0.4, 0.5, 0.6, 0.9, 1]
    edgeMaskLayer.fillColor = nil
    edgeMaskLayer.strokeColor = NSColor.white.cgColor
    edgeMaskLayer.lineWidth = 1
    edgeLayer.mask = edgeMaskLayer
    layer?.addSublayer(shadowLayer)
    layer?.addSublayer(edgeLayer)
    isHidden = true
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
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
    shadowLayer.frame = bounds
    shadowLayer.path = shapePath
    shadowLayer.shadowPath = shapePath
    edgeLayer.frame = bounds
    edgeLayer.startPoint = CGPoint(
      x: shapeBounds.minX / bounds.width,
      y: shapeBounds.maxY / bounds.height
    )
    edgeLayer.endPoint = CGPoint(
      x: shapeBounds.maxX / bounds.width,
      y: shapeBounds.minY / bounds.height
    )
    edgeLayer.contentsScale = window?.backingScaleFactor ?? 2
    edgeMaskLayer.frame = bounds
    edgeMaskLayer.path = shapePath
    edgeMaskLayer.contentsScale = edgeLayer.contentsScale
    layoutContentTopFade()
  }

  private func layoutContentTopFade() {
    guard fadesAtContentTop, bounds.height > 0, frame.minY < Self.contentTopFade else {
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

  func update(
    surfaceFrame: CGRect,
    style: Style,
    alpha: CGFloat,
    fadesAtContentTop: Bool
  ) {
    self.fadesAtContentTop = fadesAtContentTop
    shadowLayer.fillColor = NSColor(style.surfaceColor).cgColor
    shadowLayer.shadowColor = NSColor(style.shadowColor).cgColor
    shadowLayer.shadowRadius = SelectableRowShadowMetrics.radius(isDark: style.isDark)
    edgeLayer.isHidden = !style.isDark
    edgeLayer.colors = [
      NSColor(style.edgeStrongColor).cgColor,
      NSColor.clear.cgColor,
      NSColor.clear.cgColor,
      NSColor(style.edgeWeakColor).cgColor,
      NSColor.clear.cgColor,
      NSColor.clear.cgColor,
      NSColor(style.edgeStrongColor).cgColor,
    ]
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
