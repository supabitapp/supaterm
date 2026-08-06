import SwiftUI

public struct SelectableRowPalette {
  public let restFill: Color
  public let hoverFill: Color
  public let pressedFill: Color
  public let primarySelectionFill: Color
  public let secondarySelectionFill: Color
  public let selectedTitle: Color
  public let title: Color
  public let shadow: Color
}

public struct Palette {
  public let colorScheme: ColorScheme
  public let referencePalette: ReferencePalette
  public let tint: ThemeTint
  public let backgroundTopValue: ThemeColor
  public let backgroundBottomValue: ThemeColor
  public let agentPanelBackgroundValue: ThemeColor
  public let accentValue: ThemeColor
  public let warningValue: ThemeColor
  public let successValue: ThemeColor
  public let dangerValue: ThemeColor
  public let mergedValue: ThemeColor
  public let queuedValue: ThemeColor
  public let warningFillValue: ThemeColor
  public let dangerFillValue: ThemeColor
  public let dangerHoverFillValue: ThemeColor
  public let onAccentValue: ThemeColor
  public let onWarningValue: ThemeColor
  public let onSuccessValue: ThemeColor
  public let onDangerValue: ThemeColor
  public let onMergedValue: ThemeColor
  public let onWarningFillValue: ThemeColor
  public let onDangerFillValue: ThemeColor
  private let detailBackgroundValue: ThemeColor

  public var isDark: Bool { colorScheme == .dark }
  private var surfaceSeed: ThemeColor { referencePalette.neutral.light }
  private var selectableRowInkValue: ThemeColor { isDark ? .white : .black }
  private var selectableRowPrimarySelectionValue: ThemeColor { isDark ? .black : .white }
  private var selectableRowPrimarySelectionOpacity: Double { isDark ? 1 : 0.88 }

  public var backgroundIlluminationTopValue: ThemeColor {
    Self.illumination(Self.lightChromeIllumination.top, isDark: isDark)
  }
  public var backgroundIlluminationBodyValue: ThemeColor {
    Self.illumination(Self.lightChromeIllumination.body, isDark: isDark)
  }
  public var backgroundIlluminationFooterValue: ThemeColor {
    Self.illumination(Self.lightChromeIllumination.footer, isDark: isDark)
  }
  public var chromeBackgroundStartValue: ThemeColor {
    Self.chromeBackground(
      backgroundTopValue,
      illumination: backgroundIlluminationTopValue
    )
  }
  public var chromeBackgroundStopValue: ThemeColor {
    Self.chromeBackground(
      backgroundBottomValue,
      illumination: backgroundIlluminationFooterValue
    )
  }
  public var windowBackgroundTint: Color { surfaceSeed.color.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3) }
  public var detailBackground: Color { detailBackgroundValue.color }
  public var agentPanelBackground: Color { agentPanelBackgroundValue.color }
  public var detailStroke: Color { isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06) }
  public var detailShadow: Color { isDark ? .clear : Color.black.opacity(0.14) }
  public var floatingSidebarBorder: Color { Color.white.opacity(0.3) }
  public var selectableRow: SelectableRowPalette {
    let ink = selectableRowInkValue
    return SelectableRowPalette(
      restFill: ThemeColor(
        red: ink.red,
        green: ink.green,
        blue: ink.blue,
        alpha: 0.06
      ).color,
      hoverFill: ThemeColor(red: 1, green: 1, blue: 1, alpha: isDark ? 0.16 : 0.55).color,
      pressedFill: ThemeColor(red: 1, green: 1, blue: 1, alpha: isDark ? 0.31 : 0.70).color,
      primarySelectionFill: selectableRowPrimarySelectionValue.color
        .opacity(selectableRowPrimarySelectionOpacity),
      secondarySelectionFill: ThemeColor(red: 1, green: 1, blue: 1, alpha: isDark ? 0.25 : 0.70).color,
      selectedTitle: ink.color,
      title: ThemeColor(
        red: ink.red,
        green: ink.green,
        blue: ink.blue,
        alpha: isDark ? 0.78 : 0.68
      ).color,
      shadow: ThemeColor(
        red: ink.red,
        green: ink.green,
        blue: ink.blue,
        alpha: isDark ? 0.15 : 0.12
      ).color
    )
  }
  public var unselectedFill: Color { selectableRow.restFill }
  public var hoverFill: Color { selectableRow.hoverFill }
  public var pressedFill: Color { selectableRow.pressedFill }
  public var selectedFillValue: ThemeColor { isDark ? ThemeColor(red: 0.04, green: 0.04, blue: 0.04) : .white }
  public var selectedFill: Color { selectedFillValue.color }
  public var selectedStrokeBright: Color { Color.white.opacity(isDark ? 0.35 : 0.98) }
  public var selectedStrokeDim: Color { Color.white.opacity(isDark ? 0.08 : 0.98) }
  public var selectedShadow: Color { selectableRow.shadow }
  public var sidebarTabRowSelectedEdge: Color { isDark ? .clear : Color.white.opacity(0.98) }
  public var primaryTextValue: ThemeColor {
    isDark
      ? ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.94)
      : ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.86)
  }
  public var primaryText: Color { primaryTextValue.color }
  public var spaceTitleValue: ThemeColor {
    guard tint != .neutral else { return primaryTextValue }
    return ColorMath.adjustedForContrast(
      anchor: tint.tone(in: referencePalette).color(for: colorScheme),
      against: chromeBackgroundStartValue,
      minimumContrast: Self.spaceTitleContrast
    )
  }
  public var spaceTitle: Color { spaceTitleValue.color }
  public var secondaryText: Color { isDark ? Color.white.opacity(0.58) : Color.black.opacity(0.48) }
  public var sidebarGroupNeutralHoverFillValue: ThemeColor {
    isDark
      ? ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10)
      : ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.05)
  }
  public var sidebarGroupStrokeValue: ThemeColor {
    isDark
      ? ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10)
      : ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.10)
  }
  public var sidebarControlHoverFill: Color {
    (isDark ? ThemeColor(hex: 0xFAFBFF).color : ThemeColor(hex: 0x0E0F10).color).opacity(isDark ? 0.15 : 0.10)
  }
  public var sidebarControlPressedFill: Color {
    (isDark ? ThemeColor(hex: 0xFAFBFF).color : ThemeColor(hex: 0x0E0F10).color).opacity(0.065)
  }
  public var sidebarSeparator: Color { (isDark ? Color.white : .black).opacity(0.15) }
  public var selectedText: Color { selectableRow.selectedTitle }
  public var shadow: Color { .black.opacity(isDark ? 0.28 : 0.08) }
  public var scrim: Color { Color.black.opacity(0.4) }
  public var overlayShadow: Color { Color.black.opacity(0.25) }
  public var divider: Color { Color.white.opacity(0.3) }
  public var accent: Color { accentValue.color }
  public var warning: Color { warningValue.color }
  public var success: Color { successValue.color }
  public var danger: Color { dangerValue.color }
  public var merged: Color { mergedValue.color }
  public var queued: Color { queuedValue.color }
  public var warningFill: Color { warningFillValue.color }
  public var dangerFill: Color { dangerFillValue.color }
  public var dangerHoverFill: Color { dangerHoverFillValue.color }
  public var onAccent: Color { onAccentValue.color }
  public var onWarning: Color { onWarningValue.color }
  public var onSuccess: Color { onSuccessValue.color }
  public var onDanger: Color { onDangerValue.color }
  public var onMerged: Color { onMergedValue.color }
  public var onWarningFill: Color { onWarningFillValue.color }
  public var onDangerFill: Color { onDangerFillValue.color }
  public var selectedSecondaryText: Color { selectedText.opacity(0.72) }
  public var selectedPillFill: Color { selectedText.opacity(0.12) }
  public var selectedPillStroke: Color { selectedText.opacity(0.14) }

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

  public func sidebarTabPrimarySurface(over background: ThemeColor) -> ThemeColor {
    ColorMath.composited(
      selectableRowPrimarySelectionValue,
      opacity: selectableRowPrimarySelectionOpacity,
      over: background
    )
  }

  public var referenceSwatches: [ThemeSwatch] {
    referencePalette.swatches(for: colorScheme)
  }

  public func tinted(_ tint: ThemeTint) -> Palette {
    Palette(colorScheme: colorScheme, referencePalette: referencePalette, tint: tint)
  }

  public init(
    colorScheme: ColorScheme,
    referencePalette: ReferencePalette = .default,
    tint: ThemeTint = .neutral
  ) {
    self.colorScheme = colorScheme
    self.referencePalette = referencePalette
    self.tint = tint

    let surfaceSeed = referencePalette.neutral.light
    let isDark = colorScheme == .dark
    let tintColor = tint.tone(in: referencePalette).color(for: colorScheme)
    let wash = tint == .neutral ? ChromeWash.neutral : (isDark ? .dark : .light)
    let backgroundTopValue = (isDark ? ThemeColor(hex: 0x1F1F1F) : ThemeColor(hex: 0xE4E4E4))
      .mixed(with: tintColor, by: wash.top)
    let backgroundBottomValue = (isDark ? ThemeColor(hex: 0x161616) : ThemeColor(hex: 0xEDEDED))
      .mixed(with: tintColor, by: wash.bottom)
    let detailBackgroundValue = surfaceSeed.mixed(with: isDark ? .black : .white, by: 0.85)
    let agentPanelBackgroundValue = surfaceSeed.mixed(with: isDark ? .black : .white, by: isDark ? 0.82 : 0.85)
    let chromeBackgroundStartValue = Self.chromeBackground(
      backgroundTopValue,
      illumination: Self.illumination(Self.lightChromeIllumination.top, isDark: isDark)
    )
    let chromeBackgroundStopValue = Self.chromeBackground(
      backgroundBottomValue,
      illumination: Self.illumination(Self.lightChromeIllumination.footer, isDark: isDark)
    )
    let semanticBackgrounds = [
      chromeBackgroundStartValue,
      chromeBackgroundStopValue,
      agentPanelBackgroundValue,
    ]
    let accentAnchor = tint == .neutral ? referencePalette.blue.color(for: colorScheme) : tintColor
    let accentValue = Self.semantic(accentAnchor, backgrounds: semanticBackgrounds)
    let warningValue = Self.semantic(referencePalette.gold.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let successValue = Self.semantic(referencePalette.green.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let dangerValue = Self.semantic(referencePalette.rose.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let mergedValue = Self.semantic(referencePalette.violet.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let queuedValue = Self.semantic(referencePalette.clay.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let warningFillValue = Self.fill(referencePalette.gold.color(for: colorScheme), backgrounds: semanticBackgrounds)
    let onDangerFillValue = ThemeColor.white
    let dangerFillValue = Self.fill(
      referencePalette.rose.color(for: colorScheme),
      backgrounds: semanticBackgrounds,
      foreground: onDangerFillValue
    )
    let onWarningFillValue = ColorMath.readableForeground(on: warningFillValue)
    let dangerHoverFillValue = Self.fill(
      dangerFillValue.mixed(with: isDark ? .white : .black, by: 0.06),
      backgrounds: semanticBackgrounds,
      foreground: onDangerFillValue
    )

    self.backgroundTopValue = backgroundTopValue
    self.backgroundBottomValue = backgroundBottomValue
    self.detailBackgroundValue = detailBackgroundValue
    self.agentPanelBackgroundValue = agentPanelBackgroundValue
    self.accentValue = accentValue
    self.warningValue = warningValue
    self.successValue = successValue
    self.dangerValue = dangerValue
    self.mergedValue = mergedValue
    self.queuedValue = queuedValue
    self.warningFillValue = warningFillValue
    self.dangerFillValue = dangerFillValue
    self.dangerHoverFillValue = dangerHoverFillValue
    self.onAccentValue = ColorMath.readableForeground(on: accentValue)
    self.onWarningValue = ColorMath.readableForeground(on: warningValue)
    self.onSuccessValue = ColorMath.readableForeground(on: successValue)
    self.onDangerValue = ColorMath.readableForeground(on: dangerValue)
    self.onMergedValue = ColorMath.readableForeground(on: mergedValue)
    self.onWarningFillValue = onWarningFillValue
    self.onDangerFillValue = onDangerFillValue
  }

  private struct ChromeWash {
    let top: Double
    let bottom: Double

    static let neutral = ChromeWash(top: 0, bottom: 0)
    static let dark = ChromeWash(top: 0.17, bottom: 0.17)
    static let light = ChromeWash(top: 0.5, bottom: 0.18)
  }

  private struct ChromeIllumination {
    let top: Double
    let body: Double
    let footer: Double
  }

  private static let lightChromeIllumination = ChromeIllumination(top: 0.22, body: 0.36, footer: 0.62)
  private static let spaceTitleContrast = 9.0

  private static func illumination(_ opacity: Double, isDark: Bool) -> ThemeColor {
    ThemeColor(red: 1, green: 1, blue: 1, alpha: isDark ? 0 : opacity)
  }

  private static func chromeBackground(
    _ background: ThemeColor,
    illumination: ThemeColor
  ) -> ThemeColor {
    ColorMath.composited(.white, opacity: illumination.alpha, over: background)
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

  private static func fill(
    _ anchor: ThemeColor,
    backgrounds: [ThemeColor],
    foreground: ThemeColor? = nil
  ) -> ThemeColor {
    let readableForeground = foreground ?? ColorMath.readableForeground(on: anchor)
    let foregroundAdjusted = ColorMath.adjustedForContrast(
      anchor: anchor,
      against: readableForeground,
      minimumContrast: 4.5
    )
    guard
      let background = backgrounds.min(by: {
        ColorMath.contrastRatio(foregroundAdjusted, $0) < ColorMath.contrastRatio(foregroundAdjusted, $1)
      })
    else { return foregroundAdjusted }
    return ColorMath.adjustedForContrast(
      anchor: foregroundAdjusted,
      against: background,
      minimumContrast: 3
    )
  }
}
