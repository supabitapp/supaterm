import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

@MainActor
final class TerminalHorizontalTabAgentStatusView: NSView {
  private let imageView = NSImageView()
  private let dotLayers = [CAShapeLayer(), CAShapeLayer(), CAShapeLayer()]

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    imageView.imageScaling = .scaleProportionallyDown
    imageView.setAccessibilityElement(false)
    addSubview(imageView)
    for dotLayer in dotLayers {
      layer?.addSublayer(dotLayer)
    }
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var isFlipped: Bool { true }

  override func layout() {
    super.layout()
    imageView.frame = bounds
    for (index, dotLayer) in dotLayers.enumerated() {
      dotLayer.frame = bounds
      dotLayer.path = CGPath(
        ellipseIn: CGRect(x: CGFloat(index) * 4 + 1, y: bounds.midY - 1, width: 2, height: 2),
        transform: nil
      )
    }
  }

  func apply(
    _ status: TerminalHostState.TabAgentStatus?,
    palette: Palette,
    reduceMotion: Bool
  ) {
    let color: NSColor
    let symbol: String?
    switch status {
    case .needsInput:
      color = NSColor(palette.warning)
      symbol = "bell.fill"
    case .done:
      color = NSColor(palette.success)
      symbol = "checkmark"
    case .working:
      color = NSColor(palette.working)
      symbol = nil
    case nil:
      color = .clear
      symbol = nil
    }
    imageView.image = symbol.flatMap {
      NSImage(systemSymbolName: $0, accessibilityDescription: nil)
    }
    imageView.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 9, weight: .bold)
    imageView.contentTintColor = color
    imageView.isHidden = symbol == nil
    for dotLayer in dotLayers {
      dotLayer.removeAllAnimations()
      dotLayer.opacity = 1
      dotLayer.fillColor = color.cgColor
      dotLayer.isHidden = status != .working
    }
    if status == .working, !reduceMotion {
      animateDots()
    }
    isHidden = status == nil
  }

  private func animateDots() {
    for (index, dotLayer) in dotLayers.enumerated() {
      let animation = CAKeyframeAnimation(keyPath: "opacity")
      animation.values = [0.25, 1, 0.25]
      animation.keyTimes = [0, 0.5, 1]
      animation.duration = 0.9
      animation.repeatCount = .infinity
      animation.beginTime = CACurrentMediaTime() + Double(index) * 0.15
      animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      dotLayer.add(animation, forKey: "horizontalTabAgentActivity")
    }
  }
}

@MainActor
final class TerminalHorizontalTabStatusView: NSView {
  private let backgroundLayer = CAShapeLayer()
  private let dotLayers = [CAShapeLayer(), CAShapeLayer(), CAShapeLayer()]
  private let imageView = NSImageView()
  private let progressLayer = CAShapeLayer()
  private let trackLayer = CAShapeLayer()
  private var presentation: TerminalHorizontalTabTrailingStatus?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(backgroundLayer)
    layer?.addSublayer(trackLayer)
    layer?.addSublayer(progressLayer)
    for dotLayer in dotLayers {
      layer?.addSublayer(dotLayer)
    }
    imageView.imageScaling = .scaleProportionallyDown
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
    let accessoryBounds = CGRect(x: bounds.midX - 8, y: bounds.midY - 8, width: 16, height: 16)
    imageView.frame = accessoryBounds
    backgroundLayer.frame = bounds
    backgroundLayer.path =
      switch presentation {
      case .attention, .dirty:
        CGPath(
          ellipseIn: CGRect(x: bounds.midX - 3.5, y: bounds.midY - 3.5, width: 7, height: 7),
          transform: nil
        )
      default:
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .path(in: accessoryBounds)
          .cgPath
      }
    let ringRect = CGRect(x: bounds.midX - 6, y: bounds.midY - 6, width: 12, height: 12)
    let ringPath = CGPath(ellipseIn: ringRect, transform: nil)
    trackLayer.frame = bounds
    trackLayer.path = ringPath
    progressLayer.frame = bounds
    progressLayer.path = ringPath
    for (index, dotLayer) in dotLayers.enumerated() {
      dotLayer.frame = bounds
      dotLayer.path = CGPath(
        ellipseIn: CGRect(
          x: bounds.midX - 5 + CGFloat(index) * 4, y: bounds.midY - 1, width: 2, height: 2),
        transform: nil
      )
    }
  }

  func apply(
    _ presentation: TerminalHorizontalTabTrailingStatus?,
    palette: Palette,
    isSelected: Bool,
    reduceMotion: Bool
  ) {
    self.presentation = presentation
    backgroundLayer.isHidden = true
    trackLayer.isHidden = true
    progressLayer.isHidden = true
    for dotLayer in dotLayers {
      dotLayer.removeAllAnimations()
      dotLayer.opacity = 1
      dotLayer.isHidden = true
    }
    imageView.isHidden = true
    let secondary = NSColor(isSelected ? palette.selectedSecondaryText : palette.secondaryText)
    switch presentation {
    case .progress(let progress):
      let color: NSColor =
        switch progress.tone {
        case .active: secondary
        case .paused: NSColor(palette.warning)
        case .error: NSColor(palette.danger)
        }
      switch progress.indicatorStyle {
      case .ring:
        if let fraction = progress.fraction {
          trackLayer.isHidden = false
          progressLayer.isHidden = false
          trackLayer.fillColor = NSColor.clear.cgColor
          trackLayer.strokeColor = color.withAlphaComponent(isSelected ? 0.24 : 0.18).cgColor
          trackLayer.lineWidth = 1.5
          progressLayer.fillColor = NSColor.clear.cgColor
          progressLayer.strokeColor = color.cgColor
          progressLayer.lineWidth = 1.5
          progressLayer.lineCap = .round
          progressLayer.strokeEnd = max(0, min(1, fraction))
          progressLayer.transform = CATransform3DMakeRotation(-.pi / 2, 0, 0, 1)
        } else {
          for dotLayer in dotLayers {
            dotLayer.fillColor = color.cgColor
            dotLayer.isHidden = false
          }
          if !reduceMotion {
            animateDots()
          }
        }
      case .pauseIcon:
        backgroundLayer.isHidden = false
        backgroundLayer.fillColor = color.withAlphaComponent(isSelected ? 0.24 : 0.16).cgColor
        showSymbol("pause.fill", color: color, pointSize: 8)
      }
    case .attention:
      backgroundLayer.isHidden = false
      backgroundLayer.fillColor = NSColor(palette.warning).cgColor
    case .pinned:
      showSymbol("pin.fill", color: secondary, pointSize: 9)
    case .dirty:
      backgroundLayer.isHidden = false
      backgroundLayer.fillColor = secondary.cgColor
    case nil:
      break
    }
    isHidden = presentation == nil
    needsLayout = true
  }

  var presentationIsEmpty: Bool { presentation == nil }

  private func animateDots() {
    for (index, dotLayer) in dotLayers.enumerated() {
      let animation = CAKeyframeAnimation(keyPath: "opacity")
      animation.values = [0.25, 1, 0.25]
      animation.keyTimes = [0, 0.5, 1]
      animation.duration = 0.9
      animation.repeatCount = .infinity
      animation.beginTime = CACurrentMediaTime() + Double(index) * 0.15
      animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      dotLayer.add(animation, forKey: "horizontalTabProgressActivity")
    }
  }

  private func showSymbol(_ symbol: String, color: NSColor, pointSize: CGFloat) {
    imageView.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    imageView.symbolConfiguration = NSImage.SymbolConfiguration(
      pointSize: pointSize,
      weight: .semibold
    )
    imageView.contentTintColor = color
    imageView.isHidden = false
  }
}
