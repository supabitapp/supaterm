import SupaTheme
import SwiftUI

struct ChromeBackgroundView: View {
  let palette: Palette

  var body: some View {
    MeshGradient(
      width: 2,
      height: 3,
      points: Self.rampPoints,
      colors: [
        palette.backgroundTop,
        palette.backgroundTop,
        palette.backgroundBottom,
        palette.backgroundBottom,
        palette.backgroundBottom,
        palette.backgroundBottom,
      ],
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
