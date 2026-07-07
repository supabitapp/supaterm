import SwiftUI

public struct Palette {
  public let colorScheme: ColorScheme
  public let referencePalette: ReferencePalette
  public let backgroundTopValue: ThemeColor
  public let backgroundBottomValue: ThemeColor
  public let agentPanelBackgroundValue: ThemeColor
  public let accentValue: ThemeColor
  public let warningValue: ThemeColor
  public let successValue: ThemeColor
  public let dangerValue: ThemeColor
  public let mergedValue: ThemeColor
  public let onAccentValue: ThemeColor
  public let onWarningValue: ThemeColor
  public let onSuccessValue: ThemeColor
  public let onDangerValue: ThemeColor
  public let onMergedValue: ThemeColor
  private let detailBackgroundValue: ThemeColor

  private var isDark: Bool { colorScheme == .dark }
  private var surfaceSeed: ThemeColor { referencePalette.neutral.light }

  public var backgroundTop: Color { backgroundTopValue.color }
  public var backgroundBottom: Color { backgroundBottomValue.color }
  public var windowBackgroundTint: Color { surfaceSeed.color.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3) }
  public var detailBackground: Color { detailBackgroundValue.color }
  public var agentPanelBackground: Color { agentPanelBackgroundValue.color }
  public var detailStroke: Color { isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06) }
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
  public var shadow: Color { .black.opacity(isDark ? 0.28 : 0.08) }
  public var scrim: Color { Color.black.opacity(0.4) }
  public var overlayShadow: Color { Color.black.opacity(0.25) }
  public var divider: Color { Color.white.opacity(0.3) }
  public var accent: Color { accentValue.color }
  public var warning: Color { warningValue.color }
  public var success: Color { successValue.color }
  public var danger: Color { dangerValue.color }
  public var merged: Color { mergedValue.color }
  public var onAccent: Color { onAccentValue.color }
  public var onWarning: Color { onWarningValue.color }
  public var onSuccess: Color { onSuccessValue.color }
  public var onDanger: Color { onDangerValue.color }
  public var onMerged: Color { onMergedValue.color }
  public var selectedSecondaryText: Color { selectedText.opacity(0.72) }
  public var selectedPillFill: Color { selectedText.opacity(0.12) }
  public var selectedPillStroke: Color { selectedText.opacity(0.14) }
  public var dangerHoverFill: Color { danger.opacity(0.85) }

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

  public var referenceSwatches: [ThemeSwatch] {
    referencePalette.swatches(for: colorScheme)
  }

  public init(
    colorScheme: ColorScheme,
    referencePalette: ReferencePalette = .default
  ) {
    self.colorScheme = colorScheme
    self.referencePalette = referencePalette

    let surfaceSeed = referencePalette.neutral.light
    let isDark = colorScheme == .dark
    let backgroundTopValue = isDark ? ThemeColor(hex: 0x1F1F1F) : ThemeColor(hex: 0xE4E4E4)
    let backgroundBottomValue = isDark ? ThemeColor(hex: 0x191919) : ThemeColor(hex: 0xEDEDED)
    let detailBackgroundValue = surfaceSeed.mixed(with: isDark ? .black : .white, by: 0.85)
    let agentPanelBackgroundValue = surfaceSeed.mixed(with: isDark ? .black : .white, by: isDark ? 0.82 : 0.85)
    let semanticBackgrounds = [backgroundTopValue, backgroundBottomValue, agentPanelBackgroundValue]
    let accentValue = Self.semantic(referencePalette.blue.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let warningValue = Self.semantic(referencePalette.gold.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let successValue = Self.semantic(referencePalette.green.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let dangerValue = Self.semantic(referencePalette.rose.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let mergedValue = Self.semantic(referencePalette.violet.color(for: colorScheme), backgrounds: semanticBackgrounds)

    self.backgroundTopValue = backgroundTopValue
    self.backgroundBottomValue = backgroundBottomValue
    self.detailBackgroundValue = detailBackgroundValue
    self.agentPanelBackgroundValue = agentPanelBackgroundValue
    self.accentValue = accentValue
    self.warningValue = warningValue
    self.successValue = successValue
    self.dangerValue = dangerValue
    self.mergedValue = mergedValue
    self.onAccentValue = ColorMath.readableForeground(on: accentValue)
    self.onWarningValue = ColorMath.readableForeground(on: warningValue)
    self.onSuccessValue = ColorMath.readableForeground(on: successValue)
    self.onDangerValue = ColorMath.readableForeground(on: dangerValue)
    self.onMergedValue = ColorMath.readableForeground(on: mergedValue)
  }

  private static func semantic(_ anchor: ThemeColor, backgrounds: [ThemeColor]) -> ThemeColor {
    guard
      let background = backgrounds.min(by: {
        ColorMath.contrastRatio(anchor, $0) < ColorMath.contrastRatio(anchor, $1)
      })
    else { return anchor }
    return ColorMath.adjustedForContrast(
      anchor: anchor,
      against: background,
      minimumContrast: 4.5
    )
  }
}
