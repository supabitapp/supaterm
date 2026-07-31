import SupaTheme
import SwiftUI

struct ChromeBackgroundView: View {
  let palette: Palette

  @State private var outgoingPalette: Palette?
  @State private var tintOpacity: Double = 1

  var body: some View {
    WindowBackgroundEffectView()
      .overlay {
        ZStack {
          if let outgoingPalette {
            tintLayers(outgoingPalette)
          }
          tintLayers(palette)
            .opacity(tintOpacity)
        }
      }
      .overlay(GrainOverlay())
      .onChange(of: palette.tint) { previousTint, _ in
        crossfade(from: previousTint)
      }
  }

  private func tintLayers(_ palette: Palette) -> some View {
    ZStack {
      ramp(from: palette.chromeBackgroundBaseStart, to: palette.chromeBackgroundBaseStop)
        .opacity(Self.themeTintOpacity)
      ramp(from: palette.backgroundIlluminationStart, to: palette.backgroundIlluminationStop)
    }
  }

  private func ramp(from start: Color, to stop: Color) -> MeshGradient {
    MeshGradient(
      width: 2,
      height: 3,
      points: Self.compressedRampPoints,
      colors: [start, start, stop, stop, stop, stop],
      colorSpace: .perceptual
    )
  }

  private func crossfade(from previousTint: ThemeTint) {
    outgoingPalette = palette.tinted(previousTint)
    tintOpacity = 0
    Task { @MainActor in
      await Task.yield()
      withAnimation(.easeInOut(duration: Self.tintCrossfadeDuration)) {
        tintOpacity = 1
      } completion: {
        outgoingPalette = nil
      }
    }
  }

  private static let compressedRampPoints: [SIMD2<Float>] = [
    [0, 0], [1, 0],
    [0, 0.75], [1, 0.75],
    [0, 1], [1, 1],
  ]

  private static let themeTintOpacity = 0.55
  private static let tintCrossfadeDuration = 0.2
}
