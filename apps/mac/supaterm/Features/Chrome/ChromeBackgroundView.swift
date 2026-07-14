import SupaTheme
import SwiftUI

struct ChromeBackgroundView: View {
  let palette: Palette

  var body: some View {
    MeshGradient(
      width: 2,
      height: 3,
      points: Self.compressedRampPoints,
      colors: [
        palette.chromeBackgroundBaseStart,
        palette.chromeBackgroundBaseStart,
        palette.chromeBackgroundBaseStop,
        palette.chromeBackgroundBaseStop,
        palette.chromeBackgroundBaseStop,
        palette.chromeBackgroundBaseStop,
      ],
      colorSpace: .perceptual
    )
    .overlay {
      MeshGradient(
        width: 2,
        height: 3,
        points: Self.compressedRampPoints,
        colors: [
          palette.backgroundIlluminationStart,
          palette.backgroundIlluminationStart,
          palette.backgroundIlluminationStop,
          palette.backgroundIlluminationStop,
          palette.backgroundIlluminationStop,
          palette.backgroundIlluminationStop,
        ],
        colorSpace: .perceptual
      )
    }
    .overlay(GrainOverlay())
  }

  private static let compressedRampPoints: [SIMD2<Float>] = [
    [0, 0], [1, 0],
    [0, 0.75], [1, 0.75],
    [0, 1], [1, 1],
  ]
}
