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
  let effectView = NSVisualEffectView()
  let baseRampView = GradientRampView()
  let grainView = NSView()

  private var appliedTint: ThemeTint?

  init(
    material: NSVisualEffectView.Material = .underWindowBackground,
    blendingMode: NSVisualEffectView.BlendingMode = .behindWindow
  ) {
    super.init(frame: .zero)
    configureBackdrop(material: material, blendingMode: blendingMode)
    effectView.state = .followsWindowActiveState
    effectView.isEmphasized = true
    grainView.wantsLayer = true
    grainView.layer?.backgroundColor = Self.grainPattern
    for subview in [effectView, baseRampView, grainView] {
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
    let crossfades = appliedTint != nil && appliedTint != palette.tint
    appliedTint = palette.tint
    baseRampView.apply(
      ChromeBackgroundRamp.stops(palette.backgroundGradientStops),
      crossfading: crossfades
    )
  }

  private static let grainPattern: CGColor = {
    let tile = GrainTexture.tile
    let image = NSImage(cgImage: tile, size: NSSize(width: tile.width, height: tile.height))
    return NSColor(patternImage: image).cgColor
  }()
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

  static let locations = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

  static func stops(_ colors: [ThemeColor]) -> [Stop] {
    precondition(colors.count == locations.count)
    return zip(locations, colors).map { Stop(location: $0.0, color: $0.1) }
  }
}
