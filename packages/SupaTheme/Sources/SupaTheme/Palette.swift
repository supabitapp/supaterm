import AppKit
import SwiftUI

public struct Palette {
  public let primary: Color
  public let background: Theme.Background
  public let isDark: Bool
  public let windowBackgroundTint: Color
  public let detailStroke: Color
  public let destructive: Color
  public let unselectedFill: Color
  public let hoverFill: Color
  public let pressedFill: Color
  public let selectedFill: Color
  public let selectedStrokeBright: Color
  public let selectedStrokeDim: Color
  public let selectedShadow: Color
  public let primaryText: Color
  public let secondaryText: Color
  public let selectedText: Color
  public let attention: Color
  public let success: Color
  public let shadow: Color
  public let scrim: Color
  public let overlayShadow: Color
  public let divider: Color
  public let amber: Color
  public let mint: Color
  public let sky: Color
  public let coral: Color
  public let violet: Color
  public let slate: Color

  public var accent: Color { sky }
  public var selectedSecondaryText: Color { selectedText.opacity(0.72) }
  public var selectedPillFill: Color { selectedText.opacity(0.12) }
  public var selectedPillStroke: Color { selectedText.opacity(0.14) }
  public var destructiveHoverFill: Color { destructive.opacity(0.85) }

  public var detailBackground: Color {
    primary.mix(with: isDark ? .black : .white, by: 0.85)
  }

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
    let isDark = colorScheme == .dark
    let primary = theme.primary(for: colorScheme)
    self.isDark = isDark
    self.primary = primary
    background = theme.background(for: colorScheme)
    windowBackgroundTint = primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3)
    unselectedFill = (isDark ? Color.white : .black).opacity(0.06)
    hoverFill = Color.white.opacity(isDark ? 0.16 : 0.55)
    pressedFill = Color.white.opacity(isDark ? 0.31 : 0.7)
    selectedFill = isDark ? Color(white: 0.04) : .white
    selectedStrokeBright = Color.white.opacity(isDark ? 0.35 : 0.98)
    selectedStrokeDim = Color.white.opacity(isDark ? 0.08 : 0.98)
    selectedShadow = isDark ? Color.white.opacity(0.15) : Color.black.opacity(0.12)
    selectedText = isDark ? Color.white : .black

    detailStroke = isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06)
    primaryText = isDark ? Color.white.opacity(0.94) : Color.black.opacity(0.86)
    secondaryText = isDark ? Color.white.opacity(0.58) : Color.black.opacity(0.48)

    shadow = .black.opacity(isDark ? 0.28 : 0.08)
    scrim = Color.black.opacity(0.4)
    overlayShadow = Color.black.opacity(0.25)
    divider = Color.white.opacity(0.3)
    destructive = Color(red: 1, green: 0.4118, blue: 0.4118)
    attention = Color(nsColor: .systemOrange)
    success = Color(nsColor: .systemGreen)
    amber = Color(red: 0.89, green: 0.64, blue: 0.28)
    mint = Color(red: 0.3, green: 0.72, blue: 0.58)
    sky = Color(red: 0.31, green: 0.59, blue: 0.94)
    coral = Color(red: 0.9, green: 0.43, blue: 0.38)
    violet = Color(red: 0.57, green: 0.45, blue: 0.86)
    slate = Color(red: 0.38, green: 0.44, blue: 0.56)
  }

  public func fill(for tone: Tone) -> Color {
    color(for: tone).opacity(0.85)
  }

  private func color(for tone: Tone) -> Color {
    switch tone {
    case .amber:
      amber
    case .coral:
      coral
    case .mint:
      mint
    case .sky:
      sky
    case .slate:
      slate
    case .violet:
      violet
    }
  }
}
