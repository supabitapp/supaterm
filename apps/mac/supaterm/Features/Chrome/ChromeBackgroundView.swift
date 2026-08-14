import AppKit
import SupaTheme
import SwiftUI

struct ChromeBackgroundView: NSViewRepresentable {
  let palette: Palette
  let material: NSVisualEffectView.Material
  let blendingMode: NSVisualEffectView.BlendingMode

  init(
    palette: Palette,
    material: NSVisualEffectView.Material = .underWindowBackground,
    blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
  ) {
    self.palette = palette
    self.material = material
    self.blendingMode = blendingMode
  }

  func makeNSView(context: Context) -> ChromeBackgroundNSView {
    ChromeBackgroundNSView(material: material, blendingMode: blendingMode)
  }

  func updateNSView(_ nsView: ChromeBackgroundNSView, context: Context) {
    nsView.configureBackdrop(material: material, blendingMode: blendingMode)
    nsView.apply(palette)
  }
}

final class ChromeBackgroundNSView: NSView {
  static let themeTintOpacity = 0.55

  let effectView = NSVisualEffectView()
  let baseRampView = GradientRampView()
  let illuminationView = GradientRampView()
  let grainView = NSView()

  private var appliedSignature: ChromeBackgroundSignature?

  init(
    material: NSVisualEffectView.Material = .underWindowBackground,
    blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
  ) {
    super.init(frame: .zero)
    configureBackdrop(material: material, blendingMode: blendingMode)
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

  func configureBackdrop(
    material: NSVisualEffectView.Material,
    blendingMode: NSVisualEffectView.BlendingMode
  ) {
    effectView.material = material
    effectView.blendingMode = blendingMode
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func apply(_ palette: Palette) {
    let signature = ChromeBackgroundSignature(palette: palette)
    let crossfades =
      appliedSignature?.colorScheme == signature.colorScheme
      && appliedSignature != signature
      && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    appliedSignature = signature
    baseRampView.apply(
      ChromeBackgroundRamp.stops(
        from: palette.backgroundTopValue,
        to: palette.backgroundBottomValue
      ),
      crossfading: crossfades
    )
    illuminationView.apply(
      ChromeBackgroundRamp.illuminationStops(
        top: palette.backgroundIlluminationTopValue,
        body: palette.backgroundIlluminationBodyValue,
        footer: palette.backgroundIlluminationFooterValue
      ),
      crossfading: crossfades
    )
  }

  private static let grainPattern: CGColor = {
    let tile = GrainTexture.tile
    let image = NSImage(cgImage: tile, size: NSSize(width: tile.width, height: tile.height))
    return NSColor(patternImage: image).cgColor
  }()
}

private struct ChromeBackgroundSignature: Equatable {
  let colorScheme: ColorScheme
  let backgroundTop: ThemeColor
  let backgroundBottom: ThemeColor
  let illuminationTop: ThemeColor
  let illuminationBody: ThemeColor
  let illuminationFooter: ThemeColor

  init(palette: Palette) {
    colorScheme = palette.colorScheme
    backgroundTop = palette.backgroundTopValue
    backgroundBottom = palette.backgroundBottomValue
    illuminationTop = palette.backgroundIlluminationTopValue
    illuminationBody = palette.backgroundIlluminationBodyValue
    illuminationFooter = palette.backgroundIlluminationFooterValue
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.colorScheme == rhs.colorScheme
      && lhs.backgroundTop == rhs.backgroundTop
      && lhs.backgroundBottom == rhs.backgroundBottom
      && lhs.illuminationTop == rhs.illuminationTop
      && lhs.illuminationBody == rhs.illuminationBody
      && lhs.illuminationFooter == rhs.illuminationFooter
  }
}

final class GradientRampView: NSView {
  static let crossfadeDuration = 0.2
  private static let crossfadeTiming = CAMediaTimingFunction(name: .easeInEaseOut)

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

  func apply(_ stops: [ChromeBackgroundRamp.Stop], crossfading: Bool) {
    guard let gradientLayer else { return }
    let outgoingColors = gradientLayer.presentation()?.colors ?? gradientLayer.colors
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    gradientLayer.colors = stops.map(\.color.cgColor)
    gradientLayer.locations = stops.map { NSNumber(value: $0.location) }
    CATransaction.commit()
    guard crossfading, let outgoingColors else { return }
    let crossfade = CABasicAnimation(keyPath: "colors")
    crossfade.fromValue = outgoingColors
    crossfade.duration = Self.crossfadeDuration
    crossfade.timingFunction = Self.crossfadeTiming
    gradientLayer.add(crossfade, forKey: "colors")
  }
}

enum ChromeBackgroundRamp {
  struct Stop: Equatable {
    let location: Double
    let color: ThemeColor
  }

  static let rampEnd = 0.75
  static let footerStart = 0.92
  static let sampleCount = 9

  static func illuminationStops(top: ThemeColor, body: ThemeColor, footer: ThemeColor) -> [Stop] {
    [
      Stop(location: 0, color: top),
      Stop(location: footerStart, color: body),
      Stop(location: 1, color: footer),
    ]
  }

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
