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
      MeshGradient(width: 3, height: 3, points: Self.meshPoints, colors: meshColors)
        .overlay(GrainOverlay())
        .compositingGroup()
    }
  }

  private static let meshPoints: [SIMD2<Float>] = [
    [0, 0], [0.5, 0], [1, 0],
    [0, 0.5], [0.5, 0.5], [1, 0.5],
    [0, 1], [0.5, 1], [1, 1],
  ]

  private var meshColors: [Color] {
    let surface = palette.theme.primary(for: palette.isDark ? .dark : .light)
      .mix(with: .black, by: palette.isDark ? 0.8 : 0)
    let lifted = surface.mix(with: .white, by: palette.isDark ? 0.16 : 0.12)
    let deepened = surface.mix(with: .black, by: palette.isDark ? 0.3 : 0.16)
    return [0, 0.25, 0.5, 0.25, 0.5, 0.75, 0.5, 0.75, 1].map { position in
      position < 0.5
        ? lifted.mix(with: surface, by: position * 2)
        : surface.mix(with: deepened, by: (position - 0.5) * 2)
    }
  }
}
