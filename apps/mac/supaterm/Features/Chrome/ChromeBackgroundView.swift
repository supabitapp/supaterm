import AppKit
import SupaTheme
import SwiftUI

struct ChromeBackgroundView: NSViewRepresentable {
  let palette: Palette

  func makeNSView(context: Context) -> ChromeBackgroundNSView {
    ChromeBackgroundNSView()
  }

  func updateNSView(_ nsView: ChromeBackgroundNSView, context: Context) {
    nsView.apply(palette)
  }
}

final class ChromeBackgroundNSView: NSView {
  static let themeTintOpacity = 0.55

  let effectView = NSVisualEffectView()
  let baseRampView = GradientRampView()
  let illuminationView = GradientRampView()
  let grainView = NSView()

  init() {
    super.init(frame: .zero)
    effectView.material = .underWindowBackground
    effectView.blendingMode = .behindWindow
    effectView.state = .followsWindowActiveState
    effectView.isEmphasized = true
    baseRampView.alphaValue = Self.themeTintOpacity
    grainView.wantsLayer = true
    grainView.layer?.backgroundColor = Self.grainPattern
    for subview in [effectView, baseRampView, illuminationView, grainView] {
      subview.frame = bounds
      subview.autoresizingMask = [.width, .height]
      addSubview(subview)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func apply(_ palette: Palette) {
    baseRampView.apply(
      ChromeBackgroundRamp.stops(
        from: palette.chromeBackgroundBaseStartValue,
        to: palette.chromeBackgroundBaseStopValue
      )
    )
    illuminationView.apply(
      ChromeBackgroundRamp.stops(
        from: palette.backgroundIlluminationStartValue,
        to: palette.backgroundIlluminationStopValue
      )
    )
  }

  private static let grainPattern: CGColor = {
    let tile = GrainTexture.tile
    let image = NSImage(cgImage: tile, size: NSSize(width: tile.width, height: tile.height))
    return NSColor(patternImage: image).cgColor
  }()
}

final class GradientRampView: NSView {
  override var isFlipped: Bool { true }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func makeBackingLayer() -> CALayer {
    let layer = CAGradientLayer()
    layer.startPoint = CGPoint(x: 0.5, y: 0)
    layer.endPoint = CGPoint(x: 0.5, y: 1)
    return layer
  }

  var gradientLayer: CAGradientLayer? { layer as? CAGradientLayer }

  func apply(_ stops: [ChromeBackgroundRamp.Stop]) {
    guard let gradientLayer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradientLayer.colors = stops.map(\.color.cgColor)
    gradientLayer.locations = stops.map { NSNumber(value: $0.location) }
    CATransaction.commit()
  }
}

enum ChromeBackgroundRamp {
  struct Stop: Equatable {
    let location: Double
    let color: ThemeColor
  }

  static let rampEnd = 0.75
  static let sampleCount = 9

  static func stops(from start: ThemeColor, to stop: ThemeColor) -> [Stop] {
    let interior = (1..<(sampleCount - 1)).map { index in
      let progress = Double(index) / Double(sampleCount - 1)
      return Stop(
        location: rampEnd * progress,
        color: ColorMath.perceptualMix(start, stop, by: progress)
      )
    }
    return [Stop(location: 0, color: start)]
      + interior
      + [Stop(location: rampEnd, color: stop), Stop(location: 1, color: stop)]
  }
}
