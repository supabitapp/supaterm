import AppKit
import SwiftUI

public struct Palette {
  private let theme: Theme
  private let colorScheme: ColorScheme

  var background: Theme.Background { theme.background(for: colorScheme) }
  public var windowBackgroundTint: Color { primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3) }
  public var detailBackground: Color { primary.mix(with: isDark ? .black : .white, by: 0.85) }
  public var detailStroke: Color { isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06) }
  public var destructive: Color { Color(red: 1, green: 0.4118, blue: 0.4118) }
  public var unselectedFill: Color { (isDark ? Color.white : .black).opacity(0.06) }
  public var hoverFill: Color { Color.white.opacity(isDark ? 0.16 : 0.55) }
  public var pressedFill: Color { Color.white.opacity(isDark ? 0.31 : 0.7) }
  public var selectedFill: Color { isDark ? Color(white: 0.04) : .white }
  public var selectedStrokeBright: Color { Color.white.opacity(isDark ? 0.35 : 0.98) }
  public var selectedStrokeDim: Color { Color.white.opacity(isDark ? 0.08 : 0.98) }
  public var selectedShadow: Color { isDark ? Color.white.opacity(0.15) : Color.black.opacity(0.12) }
  public var primaryText: Color { isDark ? Color.white.opacity(0.94) : Color.black.opacity(0.86) }
  public var secondaryText: Color { isDark ? Color.white.opacity(0.58) : Color.black.opacity(0.48) }
  public var selectedText: Color { isDark ? Color.white : .black }
  public var attention: Color { Color(nsColor: .systemOrange) }
  public var success: Color { Color(nsColor: .systemGreen) }
  public var shadow: Color { .black.opacity(isDark ? 0.28 : 0.08) }
  public var scrim: Color { Color.black.opacity(0.4) }
  public var overlayShadow: Color { Color.black.opacity(0.25) }
  public var divider: Color { Color.white.opacity(0.3) }
  public var amber: Color { Color(red: 0.89, green: 0.64, blue: 0.28) }
  public var mint: Color { Color(red: 0.3, green: 0.72, blue: 0.58) }
  public var sky: Color { Color(red: 0.31, green: 0.59, blue: 0.94) }
  public var coral: Color { Color(red: 0.9, green: 0.43, blue: 0.38) }
  public var violet: Color { Color(red: 0.57, green: 0.45, blue: 0.86) }
  public var slate: Color { Color(red: 0.38, green: 0.44, blue: 0.56) }
  public var accent: Color { sky }
  public var selectedSecondaryText: Color { selectedText.opacity(0.72) }
  public var selectedPillFill: Color { selectedText.opacity(0.12) }
  public var selectedPillStroke: Color { selectedText.opacity(0.14) }
  public var destructiveHoverFill: Color { destructive.opacity(0.85) }
  private var isDark: Bool { colorScheme == .dark }
  private var primary: Color { theme.primary(for: colorScheme) }

  public var selectedStroke: LinearGradient {
    LinearGradient(
      stops: [
        Gradient.Stop(color: selectedStrokeBright, location: 0),
        Gradient.Stop(color: selectedStrokeDim, location: 0.5),
        Gradient.Stop(color: selectedStrokeBright, location: 1),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  public init(theme: Theme = .default, colorScheme: ColorScheme) {
    self.theme = theme
    self.colorScheme = colorScheme
  }
}
