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
        width: 2,
        height: 3,
        points: Self.rampPoints,
        colors: rampColors,
        colorSpace: .perceptual
      )
      .overlay(GrainOverlay())
      .compositingGroup()
    }
  }

  private static let rampPoints: [SIMD2<Float>] = [
    [0, 0], [1, 0],
    [0, 0.75], [1, 0.75],
    [0, 1], [1, 1],
  ]

  private var rampColors: [Color] {
    let pole = palette.isDark ? Color(white: 0.12) : .white
    let start = palette.primary.mix(with: pole, by: 0.75)
    let end = palette.primary.mix(with: pole, by: 0.92)
    return [start, start, end, end, end, end]
  }
}
