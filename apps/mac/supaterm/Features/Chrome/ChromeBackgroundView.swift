import SupaTheme
import SwiftUI

struct ChromeBackgroundView: View {
  let palette: Palette

  var body: some View {
    palette.backgroundTop
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
      .overlay {
        MeshGradient(
          width: 2,
          height: 2,
          points: Self.fullRampPoints,
          colors: [
            palette.backgroundTintStart,
            palette.backgroundTintStart,
            palette.backgroundTintStop,
            palette.backgroundTintStop,
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

  private static let fullRampPoints: [SIMD2<Float>] = [
    [0, 0], [1, 0],
    [0, 1], [1, 1],
  ]
}
