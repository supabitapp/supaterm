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

  public var isDark: Bool { colorScheme == .dark }
  private var triTone: ReferenceTriTone { tint.triTone(in: referencePalette) }
  private var foregroundValue: ThemeColor { isDark ? .white : .black }
  private var detailBackgroundValue: ThemeColor {
    isDark
      ? ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.5)
      : ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.75)
  }
  private var selectableRowInkValue: ThemeColor { isDark ? .white : .black }
  private var selectableRowPrimarySelectionValue: ThemeColor { isDark ? .black : .white }

  public var backgroundGradientStops: [ThemeColor] {
    Self.backgroundStops(for: triTone, isDark: isDark, neutral: tint == .neutral)
  }
  public var backgroundTopValue: ThemeColor { backgroundGradientStops[0] }
  public var backgroundBottomValue: ThemeColor { backgroundGradientStops[backgroundGradientStops.count - 1] }
  public var chromeBackgroundStartValue: ThemeColor { backgroundTopValue }
  public var chromeBackgroundStopValue: ThemeColor { backgroundBottomValue }
  public var windowBackgroundTint: Color { (isDark ? Color.black : Color.white).opacity(isDark ? 0.5 : 0.75) }
  public var agentPanelBackgroundValue: ThemeColor { detailBackgroundValue }
  public var accentValue: ThemeColor { triTone.primary.color(for: colorScheme) }
  public var warningValue: ThemeColor { triTone.secondary.color(for: colorScheme) }
  public var successValue: ThemeColor { triTone.tertiary.color(for: colorScheme) }
  public var dangerValue: ThemeColor { triTone.vibrant.color(for: colorScheme) }
  public var mergedValue: ThemeColor { warningValue }
  public var queuedValue: ThemeColor { successValue }
  public var warningFillValue: ThemeColor { Self.withAlpha(accentValue, isDark ? 1 : 0.9) }
  public var dangerFillValue: ThemeColor { Self.withAlpha(dangerValue, isDark ? 1 : 0.9) }
  public var dangerHoverFillValue: ThemeColor { Self.withAlpha(dangerValue, isDark ? 1 : 0.8) }
  public var onAccentValue: ThemeColor { foregroundValue }
  public var onWarningValue: ThemeColor { foregroundValue }
  public var onSuccessValue: ThemeColor { foregroundValue }
  public var onDangerValue: ThemeColor { foregroundValue }
  public var onMergedValue: ThemeColor { foregroundValue }
  public var onWarningFillValue: ThemeColor { foregroundValue }
  public var onDangerFillValue: ThemeColor { foregroundValue }
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
        alpha: 0.05
      ).color,
      hoverFill: ThemeColor(
        red: selectableRowPrimarySelectionValue.red,
        green: selectableRowPrimarySelectionValue.green,
        blue: selectableRowPrimarySelectionValue.blue,
        alpha: 0.07
      ).color,
      pressedFill: ThemeColor(
        red: selectableRowPrimarySelectionValue.red,
        green: selectableRowPrimarySelectionValue.green,
        blue: selectableRowPrimarySelectionValue.blue,
        alpha: 0.12
      ).color,
      primarySelectionFill: selectableRowPrimarySelectionValue.color,
      secondarySelectionFill: ThemeColor(
        red: selectableRowPrimarySelectionValue.red,
        green: selectableRowPrimarySelectionValue.green,
        blue: selectableRowPrimarySelectionValue.blue,
        alpha: 0.3
      ).color,
      selectedTitle: ink.color,
      title: ThemeColor(
        red: ink.red,
        green: ink.green,
        blue: ink.blue,
        alpha: 0.6
      ).color,
      shadow: ThemeColor(
        red: ink.red,
        green: ink.green,
        blue: ink.blue,
        alpha: 0.09
      ).color
    )
  }
  public var unselectedFill: Color { selectableRow.restFill }
  public var hoverFill: Color { selectableRow.hoverFill }
  public var pressedFill: Color { selectableRow.pressedFill }
  public var selectedFillValue: ThemeColor { isDark ? ThemeColor(red: 0.04, green: 0.04, blue: 0.04) : .white }
  public var selectedFill: Color { selectedFillValue.color }
  public var selectedStrokeBright: Color { (isDark ? Color.white : Color.black).opacity(0.12) }
  public var selectedStrokeDim: Color { (isDark ? Color.white : Color.black).opacity(0.05) }
  public var selectedShadow: Color { selectableRow.shadow }
  public var sidebarTabRowSelectedEdge: Color { (isDark ? Color.white : Color.black).opacity(0.12) }
  public var primaryTextValue: ThemeColor {
    isDark
      ? ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.95)
      : ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.95)
  }
  public var primaryText: Color { primaryTextValue.color }
  public var spaceTitleValue: ThemeColor {
    guard tint != .neutral else { return primaryTextValue }
    return triTone.primary.color(for: colorScheme)
  }
  public var spaceTitle: Color { spaceTitleValue.color }
  public var secondaryText: Color { (isDark ? Color.white : Color.black).opacity(0.6) }
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
    (isDark ? Color.white : Color.black).opacity(0.07)
  }
  public var sidebarControlPressedFill: Color {
    (isDark ? Color.white : Color.black).opacity(0.12)
  }
  public var sidebarSeparator: Color { (isDark ? Color.white : .black).opacity(0.12) }
  public var selectedText: Color { selectableRow.selectedTitle }
  public var shadow: Color { (isDark ? Color.white : Color.black).opacity(0.12) }
  public var scrim: Color { Color.black.opacity(0.4) }
  public var overlayShadow: Color { (isDark ? Color.white : Color.black).opacity(0.12) }
  public var divider: Color { (isDark ? Color.white : Color.black).opacity(0.12) }
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
      opacity: 1,
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
  }

  private static let referenceLightBackgroundStops = [
    ThemeColor(hex: 0xFFFFFF),
    ThemeColor(hex: 0xFFFADB),
    ThemeColor(hex: 0xF0A775),
    ThemeColor(hex: 0xA869A3),
    ThemeColor(hex: 0x8660EF),
    ThemeColor(hex: 0x4160FF),
  ]

  private static let referenceDarkBackgroundStops = Array(
    repeating: ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.5), count: 6)

  private static func backgroundStops(
    for triTone: ReferenceTriTone,
    isDark: Bool,
    neutral: Bool
  ) -> [ThemeColor] {
    if neutral {
      return isDark ? referenceDarkBackgroundStops : referenceLightBackgroundStops
    }
    let colorScheme = isDark ? ColorScheme.dark : .light
    return [
      triTone.primary.color(for: colorScheme),
      triTone.secondary.color(for: colorScheme),
      triTone.tertiary.color(for: colorScheme),
      triTone.vibrant.color(for: colorScheme),
      triTone.secondary.color(for: colorScheme),
      triTone.primary.color(for: colorScheme),
    ]
  }

  private static func withAlpha(_ color: ThemeColor, _ alpha: Double) -> ThemeColor {
    ThemeColor(red: color.red, green: color.green, blue: color.blue, alpha: alpha)
  }
}
