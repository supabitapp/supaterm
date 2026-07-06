import SwiftUI

public struct ThemeBackgroundView: View {
  public let palette: Palette

  public init(palette: Palette) {
    self.palette = palette
  }

  public var body: some View {
    let top = palette.background.top
    let bottom = palette.background.bottom
    MeshGradient(
      width: 2,
      height: 3,
      points: Self.rampPoints,
      colors: [top, top, bottom, bottom, bottom, bottom],
      colorSpace: .perceptual
    )
    .overlay(GrainOverlay())
  }

  private static let rampPoints: [SIMD2<Float>] = [
    [0, 0], [1, 0],
    [0, 0.75], [1, 0.75],
    [0, 1], [1, 1],
  ]
}
