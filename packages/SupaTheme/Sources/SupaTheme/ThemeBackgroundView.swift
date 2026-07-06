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
    let top = palette.background.top
    let bottom = palette.background.bottom
    return [top, top, bottom, bottom, bottom, bottom]
  }
}
