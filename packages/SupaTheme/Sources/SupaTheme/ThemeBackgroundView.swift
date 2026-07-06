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
    let start: Color
    let end: Color
    if palette.isDark {
      start = palette.primary.mix(with: .black, by: 0.66)
      end = palette.primary.mix(with: .black, by: 0.84)
    } else {
      start = palette.primary.mix(with: .white, by: 0.75)
      end = palette.primary.mix(with: .white, by: 0.92)
    }
    return [start, start, end, end, end, end]
  }
}
