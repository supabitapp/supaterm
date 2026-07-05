import SwiftUI

public struct ThemeBackgroundView: View {
  public enum Style {
    case flat
    case gradient
  }

  public let palette: Palette
  public let style: Style

  public init(palette: Palette, style: Style) {
    self.palette = palette
    self.style = style
  }

  public var body: some View {
    switch style {
    case .flat:
      palette.windowBackgroundTint
    case .gradient:
      MeshGradient(
        width: 3,
        height: 2,
        points: Self.rampPoints,
        colors: rampColors,
        colorSpace: .perceptual
      )
      .overlay(GrainOverlay())
      .compositingGroup()
    }
  }

  private static let rampPoints: [SIMD2<Float>] = [
    [0, 0], [0.75, 0], [1, 0],
    [0, 1], [0.75, 1], [1, 1],
  ]

  private var rampColors: [Color] {
    let surface = palette.primary.mix(with: .black, by: palette.isDark ? 0.8 : 0)
    let start = surface.mix(with: .white, by: palette.isDark ? 0.16 : 0.12)
    let end = surface.mix(with: .black, by: palette.isDark ? 0.3 : 0.16)
    return [start, end, end, start, end, end]
  }
}
