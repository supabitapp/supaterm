import CoreGraphics
import Foundation
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

private func expectSameThemeColor(
  _ actual: ThemeColor,
  _ expected: ThemeColor,
  _ token: String,
  tolerance: Double = 0.0001,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  #expect(
    abs(actual.red - expected.red) < tolerance
      && abs(actual.green - expected.green) < tolerance
      && abs(actual.blue - expected.blue) < tolerance
      && abs(actual.alpha - expected.alpha) < tolerance,
    "\(token): \(actual) != \(expected)",
    sourceLocation: sourceLocation
  )
}

private func expectSameColor(
  _ actual: Color,
  _ expected: Color,
  _ token: String,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  let resolvedActual = actual.resolve(in: EnvironmentValues())
  let resolvedExpected = expected.resolve(in: EnvironmentValues())
  #expect(
    abs(resolvedActual.red - resolvedExpected.red) < 0.0001
      && abs(resolvedActual.green - resolvedExpected.green) < 0.0001
      && abs(resolvedActual.blue - resolvedExpected.blue) < 0.0001
      && abs(resolvedActual.opacity - resolvedExpected.opacity) < 0.0001,
    "\(token): \(resolvedActual) != \(resolvedExpected)",
    sourceLocation: sourceLocation
  )
}

private func hueDelta(_ first: ColorMath.OKLCH, _ second: ColorMath.OKLCH) -> Double {
  abs(atan2(sin(first.hue - second.hue), cos(first.hue - second.hue)))
}

@MainActor
struct ChromePaletteTests {
  @Test func referenceAnchorsMatchExpectedValues() {
    let reference = ReferencePalette.default
    expectSameThemeColor(reference.neutral.light, ThemeColor(hex: 0xE3E6EC), "neutralLight")
    expectSameThemeColor(reference.neutral.dark, ThemeColor(hex: 0x9AA2AF), "neutralDark")
    expectSameThemeColor(reference.rose.light, ThemeColor(hex: 0xC1575C), "roseLight")
    expectSameThemeColor(reference.rose.dark, ThemeColor(hex: 0xCC4A55), "roseDark")
    expectSameThemeColor(reference.clay.light, ThemeColor(hex: 0xD87249), "clayLight")
    expectSameThemeColor(reference.clay.dark, ThemeColor(hex: 0xC95125), "clayDark")
    expectSameThemeColor(reference.gold.light, ThemeColor(hex: 0xE3AC38), "goldLight")
    expectSameThemeColor(reference.gold.dark, ThemeColor(hex: 0xC98400), "goldDark")
    expectSameThemeColor(reference.green.light, ThemeColor(hex: 0x3EB489), "greenLight")
    expectSameThemeColor(reference.green.dark, ThemeColor(hex: 0x008B5D), "greenDark")
    expectSameThemeColor(reference.blush.light, ThemeColor(hex: 0xD37B8B), "blushLight")
    expectSameThemeColor(reference.blush.dark, ThemeColor(hex: 0xBD556B), "blushDark")
    expectSameThemeColor(reference.blue.light, ThemeColor(hex: 0x3A88C4), "blueLight")
    expectSameThemeColor(reference.blue.dark, ThemeColor(hex: 0x007FBD), "blueDark")
    expectSameThemeColor(reference.violet.light, ThemeColor(hex: 0x5F5B9E), "violetLight")
    expectSameThemeColor(reference.violet.dark, ThemeColor(hex: 0x625DA5), "violetDark")
  }

  @Test func lightSchemeMatchesExpectedSurfaces() {
    expectDefaultSurfaceTokens(Palette(colorScheme: .light), isDark: false)
  }

  @Test func darkSchemeMatchesExpectedSurfaces() {
    expectDefaultSurfaceTokens(Palette(colorScheme: .dark), isDark: true)
  }

  @Test func darkSidebarPrimarySelectionIsOpaqueBlack() {
    let palette = Palette(colorScheme: .dark)
    expectSameThemeColor(palette.sidebarTabPrimarySurfaceValue, .black, "sidebarTabPrimarySurface")
  }

  @Test func lightSidebarPrimarySelectionIsOpaqueWhite() {
    for tint in ThemeTint.chromatic {
      let palette = Palette(colorScheme: .light, tint: tint)
      expectSameThemeColor(
        palette.sidebarTabPrimarySurfaceValue,
        .white,
        "sidebarTabPrimarySurface-\(tint.rawValue)"
      )
    }
  }

  @Test func foregroundFollowsColorScheme() {
    expectSameColor(Palette(colorScheme: .light).primaryText, Color.black.opacity(0.86), "lightPrimaryText")
    expectSameColor(Palette(colorScheme: .dark).primaryText, Color.white.opacity(0.94), "darkPrimaryText")
    expectSameColor(Palette(colorScheme: .light).secondaryText, Color.black.opacity(0.48), "lightSecondaryText")
    expectSameColor(Palette(colorScheme: .dark).secondaryText, Color.white.opacity(0.58), "darkSecondaryText")
  }

  @Test func neutralSpaceTitleKeepsThePrimaryTextInk() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let palette = Palette(colorScheme: colorScheme)
      expectSameThemeColor(palette.spaceTitleValue, palette.primaryTextValue, "spaceTitleValue")
      expectSameColor(palette.spaceTitle, palette.primaryText, "spaceTitle")
    }
  }

  @Test func chromaticSpaceTitleHoldsTheTintHueAtPrimaryTextContrast() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      for tint in ThemeTint.chromatic {
        let palette = Palette(colorScheme: colorScheme, tint: tint)
        let background = palette.backgroundTopValue
        let ink = palette.primaryTextValue
        let title = ColorMath.oklch(from: palette.spaceTitleValue)
        let anchor = ColorMath.oklch(from: tint.tone(in: .default).color(for: colorScheme))
        expectContrast(
          palette.spaceTitleValue,
          background,
          minimum: ColorMath.contrastRatio(
            ColorMath.composited(ink, opacity: ink.alpha, over: background),
            background
          ),
          token: "spaceTitle-\(colorScheme)-\(tint.rawValue)"
        )
        #expect(
          hueDelta(title, anchor) < 0.01,
          "spaceTitleHue-\(colorScheme)-\(tint.rawValue): \(hueDelta(title, anchor))"
        )
        #expect(title.chroma > 0.01, "spaceTitleChroma-\(colorScheme)-\(tint.rawValue): \(title.chroma)")
        #expect(
          colorScheme == .dark ? title.lightness > anchor.lightness : title.lightness < anchor.lightness,
          "spaceTitleLightness-\(colorScheme)-\(tint.rawValue): \(title.lightness) vs \(anchor.lightness)"
        )
      }
    }
  }

  @Test func chromaticTintsWashChromeSurfacesOnly() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let neutral = Palette(colorScheme: colorScheme)
      for tint in ThemeTint.allCases where tint != .neutral {
        let palette = Palette(colorScheme: colorScheme, tint: tint)
        #expect(palette.backgroundTopValue != neutral.backgroundTopValue, "\(tint.rawValue)")
        #expect(palette.backgroundBottomValue != neutral.backgroundBottomValue, "\(tint.rawValue)")
        expectSameThemeColor(
          palette.agentPanelBackgroundValue,
          neutral.agentPanelBackgroundValue,
          "agentPanelBackground-\(tint.rawValue)"
        )
      }
    }
  }

  @Test func darkTintWashKeepsTheReferenceMix() {
    for tint in ThemeTint.chromatic {
      let palette = Palette(colorScheme: .dark, tint: tint)
      let tone = tint.tone(in: .default).color(for: .dark)
      expectSameThemeColor(
        palette.backgroundTopValue,
        ThemeColor(hex: 0x1F1F1F).mixed(with: tone, by: 0.17),
        "darkBackgroundTop-\(tint.rawValue)"
      )
      expectSameThemeColor(
        palette.backgroundBottomValue,
        ThemeColor(hex: 0x161616).mixed(with: tone, by: 0.17),
        "darkBackgroundBottom-\(tint.rawValue)"
      )
      expectSameThemeColor(
        palette.chromeBackgroundStartValue,
        palette.backgroundTopValue,
        "darkChromeBackgroundStart-\(tint.rawValue)"
      )
      expectSameThemeColor(
        palette.chromeBackgroundStopValue,
        palette.backgroundBottomValue,
        "darkChromeBackgroundStop-\(tint.rawValue)"
      )
    }
  }

  @Test func lightChromeRunsFromAChromaticTopToAPaleFooter() {
    for tint in ThemeTint.chromatic {
      let palette = Palette(colorScheme: .light, tint: tint)
      let top = palette.chromeBackgroundStartValue
      let footer = palette.chromeBackgroundStopValue
      #expect(
        ColorMath.oklch(from: top).chroma > ColorMath.oklch(from: footer).chroma,
        "\(tint.rawValue) chroma"
      )
      #expect(ColorMath.oklch(from: footer).chroma > 0, "\(tint.rawValue) footer chroma")
      #expect(
        ColorMath.relativeLuminance(top) < ColorMath.relativeLuminance(footer),
        "\(tint.rawValue) luminance"
      )
      #expect(
        palette.backgroundIlluminationTopValue.alpha < palette.backgroundIlluminationBodyValue.alpha,
        "\(tint.rawValue) body illumination"
      )
      #expect(
        palette.backgroundIlluminationBodyValue.alpha < palette.backgroundIlluminationFooterValue.alpha,
        "\(tint.rawValue) footer illumination"
      )
    }
  }

  @Test func neutralTintKeepsChromeSurfacesGray() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let palette = Palette(colorScheme: colorScheme)
      for surface in [palette.chromeBackgroundStartValue, palette.chromeBackgroundStopValue] {
        #expect(ColorMath.oklch(from: surface).chroma < 0.0001)
      }
    }
  }

  @Test func retintingKeepsTheSchemeAndMatchesADirectlyBuiltPalette() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let palette = Palette(colorScheme: colorScheme, tint: .blue).tinted(.green)
      let expected = Palette(colorScheme: colorScheme, tint: .green)
      #expect(palette.colorScheme == colorScheme)
      #expect(palette.tint == .green)
      expectSameThemeColor(palette.backgroundTopValue, expected.backgroundTopValue, "backgroundTop")
      expectSameThemeColor(palette.backgroundBottomValue, expected.backgroundBottomValue, "backgroundBottom")
    }
  }

  @Test func workingTokenKeepsTheReferenceBlueHueAcrossSpaceTints() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let anchor = ColorMath.oklch(from: ReferencePalette.default.blue.color(for: colorScheme))
      for tint in ThemeTint.allCases {
        let working = ColorMath.oklch(from: Palette(colorScheme: colorScheme, tint: tint).workingValue)
        #expect(
          hueDelta(working, anchor) < 0.01,
          "working-\(colorScheme)-\(tint.rawValue): \(hueDelta(working, anchor))"
        )
      }
    }
  }

  @Test func tintedSemanticTokensMeetContrastOnChromeSurfaces() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      for tint in ThemeTint.allCases {
        let palette = Palette(colorScheme: colorScheme, tint: tint)
        for background in [
          palette.agentPanelBackgroundValue,
          palette.backgroundTopValue,
          palette.backgroundBottomValue,
        ] {
          expectContrast(palette.accentValue, background, minimum: 4.5, token: "accent-\(tint.rawValue)")
          expectContrast(palette.workingValue, background, minimum: 4.5, token: "working-\(tint.rawValue)")
          expectContrast(palette.warningValue, background, minimum: 4.5, token: "warning-\(tint.rawValue)")
          expectContrast(palette.successValue, background, minimum: 4.5, token: "success-\(tint.rawValue)")
          expectContrast(palette.dangerValue, background, minimum: 4.5, token: "danger-\(tint.rawValue)")
          expectContrast(palette.mergedValue, background, minimum: 4.5, token: "merged-\(tint.rawValue)")
          expectContrast(palette.queuedValue, background, minimum: 4.5, token: "queued-\(tint.rawValue)")
        }
        expectContrast(palette.onAccentValue, palette.accentValue, minimum: 4.5, token: "onAccent-\(tint.rawValue)")
      }
    }
  }

  @Test func semanticTokensMeetContrastOnChromeSurfaces() {
    for palette in [Palette(colorScheme: .light), Palette(colorScheme: .dark)] {
      for background in [
        palette.agentPanelBackgroundValue,
        palette.backgroundTopValue,
        palette.backgroundBottomValue,
      ] {
        expectContrast(palette.accentValue, background, minimum: 4.5, token: "accent")
        expectContrast(palette.workingValue, background, minimum: 4.5, token: "working")
        expectContrast(palette.warningValue, background, minimum: 4.5, token: "warning")
        expectContrast(palette.successValue, background, minimum: 4.5, token: "success")
        expectContrast(palette.dangerValue, background, minimum: 4.5, token: "danger")
        expectContrast(palette.mergedValue, background, minimum: 4.5, token: "merged")
        expectContrast(palette.queuedValue, background, minimum: 4.5, token: "queued")
      }
      expectContrast(palette.onAccentValue, palette.accentValue, minimum: 4.5, token: "onAccent")
      expectContrast(palette.onWarningValue, palette.warningValue, minimum: 4.5, token: "onWarning")
      expectContrast(palette.onSuccessValue, palette.successValue, minimum: 4.5, token: "onSuccess")
      expectContrast(palette.onDangerValue, palette.dangerValue, minimum: 4.5, token: "onDanger")
      expectContrast(palette.onMergedValue, palette.mergedValue, minimum: 4.5, token: "onMerged")
    }
  }

  @Test func fillTokensMeetControlContrast() {
    for palette in [Palette(colorScheme: .light), Palette(colorScheme: .dark)] {
      for background in [
        palette.agentPanelBackgroundValue,
        palette.backgroundTopValue,
        palette.backgroundBottomValue,
      ] {
        expectContrast(palette.warningFillValue, background, minimum: 3, token: "warningFill")
        expectContrast(palette.dangerFillValue, background, minimum: 3, token: "dangerFill")
        expectContrast(palette.dangerHoverFillValue, background, minimum: 3, token: "dangerHoverFill")
      }
      for background in [palette.chromeBackgroundStartValue, palette.chromeBackgroundStopValue] {
        expectContrast(palette.warningFillValue, background, minimum: 3, token: "warningFill")
      }
      expectContrast(palette.onWarningFillValue, palette.warningFillValue, minimum: 4.5, token: "onWarningFill")
      expectContrast(palette.onDangerFillValue, palette.dangerFillValue, minimum: 4.5, token: "onDangerFill")
      expectContrast(palette.onDangerFillValue, palette.dangerHoverFillValue, minimum: 4.5, token: "onDangerHoverFill")
      expectSameThemeColor(palette.onWarningFillValue, .black, "onWarningFill")
      expectSameThemeColor(palette.onDangerFillValue, .white, "onDangerFill")
    }
  }

  @Test func colorMathComputesContrastAndReadableForeground() {
    #expect(abs(ColorMath.contrastRatio(.black, .white) - 21) < 0.0001)
    expectSameThemeColor(ColorMath.readableForeground(on: .black), .white, "blackForeground")
    expectSameThemeColor(ColorMath.readableForeground(on: .white), .black, "whiteForeground")
  }

  @Test func perceptualMixInterpolatesInOKLab() {
    let mixed = ColorMath.perceptualMix(ThemeColor(hex: 0x2F7EC8), ThemeColor(hex: 0xF0C766), by: 0.36 / 0.54)
    expectSameThemeColor(mixed, ThemeColor(hex: 0xB4B294), "clearSunriseMidpoint", tolerance: 0.003)
  }

  @Test func oklchRoundTripsRepresentativeColors() {
    for color in [
      ThemeColor(hex: 0x3A88C4),
      ThemeColor(hex: 0xC98400),
      ThemeColor(hex: 0xE3E6EC),
    ] {
      let roundTrip = ColorMath.color(from: ColorMath.oklch(from: color))
      expectSameThemeColor(roundTrip, color, "roundTrip", tolerance: 0.00001)
    }
  }

  @Test func contrastAdjustmentComputesDisplayableColor() {
    let background = Palette(colorScheme: .dark).agentPanelBackgroundValue
    let adjusted = ColorMath.adjustedForContrast(
      anchor: ReferencePalette.default.violet.dark,
      against: background,
      minimumContrast: 4.5
    )
    expectContrast(adjusted, background, minimum: 4.5, token: "adjustedViolet")
    #expect(adjusted.red >= 0 && adjusted.red <= 1)
    #expect(adjusted.green >= 0 && adjusted.green <= 1)
    #expect(adjusted.blue >= 0 && adjusted.blue <= 1)
  }

  @Test func clampedOklchColorStaysDisplayable() {
    let color = ColorMath.clampedColor(
      from: ColorMath.OKLCH(lightness: 0.65, chroma: 0.5, hue: 0.2)
    )
    #expect(color.red >= 0 && color.red <= 1)
    #expect(color.green >= 0 && color.green <= 1)
    #expect(color.blue >= 0 && color.blue <= 1)
  }

  private func expectDefaultSurfaceTokens(_ palette: Palette, isDark: Bool) {
    let surfaceSeed = ReferencePalette.default.neutral.light
    expectSameThemeColor(
      palette.backgroundTopValue,
      isDark ? ThemeColor(hex: 0x1F1F1F) : ThemeColor(hex: 0xE4E4E4),
      "backgroundTopValue"
    )
    expectSameThemeColor(
      palette.backgroundBottomValue,
      isDark ? ThemeColor(hex: 0x161616) : ThemeColor(hex: 0xEDEDED),
      "backgroundBottomValue"
    )
    expectBackgroundLayerTokens(palette, isDark: isDark)
    expectSameColor(
      palette.windowBackgroundTint,
      surfaceSeed.color.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3),
      "windowBackgroundTint"
    )
    expectSameColor(
      palette.detailBackground,
      surfaceSeed.mixed(with: isDark ? .black : .white, by: 0.85).color,
      "detailBackground"
    )
    expectSameColor(
      palette.agentPanelBackground,
      palette.agentPanelBackgroundValue.color,
      "agentPanelBackground"
    )
    expectSameColor(
      palette.detailStroke,
      isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06),
      "detailStroke"
    )
    expectSameColor(
      palette.detailShadow,
      isDark ? .clear : Color.black.opacity(0.14),
      "detailShadow"
    )
    expectSameColor(
      palette.floatingSidebarBorder,
      Color.white.opacity(0.3),
      "floatingSidebarBorder"
    )
    expectSameColor(palette.unselectedFill, (isDark ? Color.white : .black).opacity(0.06), "unselectedFill")
    expectSameColor(palette.hoverFill, Color.white.opacity(isDark ? 0.16 : 0.55), "hoverFill")
    expectSameColor(palette.pressedFill, Color.white.opacity(isDark ? 0.31 : 0.7), "pressedFill")
    expectSameColor(palette.selectedFill, isDark ? Color(white: 0.04) : .white, "selectedFill")
    expectSameColor(palette.selectedStrokeBright, Color.white.opacity(isDark ? 0.35 : 0.98), "selectedStrokeBright")
    expectSameColor(palette.selectedStrokeDim, Color.white.opacity(isDark ? 0.08 : 0.98), "selectedStrokeDim")
    expectSameColor(
      palette.selectedShadow,
      isDark ? Color.white.opacity(0.15) : Color.black.opacity(0.12),
      "selectedShadow"
    )
    expectSameColor(palette.selectedText, isDark ? Color.white : .black, "selectedText")
    expectSidebarTabRowTokens(palette, isDark: isDark)
    expectSameColor(
      palette.selectedSecondaryText,
      (isDark ? Color.white : .black).opacity(0.72),
      "selectedSecondaryText"
    )
    expectSameColor(
      palette.selectedPillFill,
      (isDark ? Color.white : .black).opacity(0.12),
      "selectedPillFill"
    )
    expectSameColor(
      palette.selectedPillStroke,
      (isDark ? Color.white : .black).opacity(0.14),
      "selectedPillStroke"
    )
    expectSameColor(palette.shadow, Color.black.opacity(isDark ? 0.28 : 0.08), "shadow")
    expectSameColor(palette.scrim, Color.black.opacity(0.4), "scrim")
    expectSameColor(palette.overlayShadow, Color.black.opacity(0.25), "overlayShadow")
    expectSameColor(palette.divider, Color.white.opacity(0.3), "divider")
  }

  private func expectBackgroundLayerTokens(_ palette: Palette, isDark: Bool) {
    let illuminationOpacities = isDark ? [0, 0, 0] : [0.22, 0.36, 0.62]
    let illuminations = [
      palette.backgroundIlluminationTopValue,
      palette.backgroundIlluminationBodyValue,
      palette.backgroundIlluminationFooterValue,
    ]
    for (illumination, opacity) in zip(illuminations, illuminationOpacities) {
      expectSameThemeColor(
        illumination,
        ThemeColor(red: 1, green: 1, blue: 1, alpha: opacity),
        "backgroundIllumination-\(opacity)"
      )
    }
    expectSameThemeColor(
      palette.chromeBackgroundStartValue,
      ColorMath.composited(.white, opacity: illuminationOpacities[0], over: palette.backgroundTopValue),
      "chromeBackgroundStartValue"
    )
    expectSameThemeColor(
      palette.chromeBackgroundStopValue,
      ColorMath.composited(.white, opacity: illuminationOpacities[2], over: palette.backgroundBottomValue),
      "chromeBackgroundStopValue"
    )
  }

  private func expectSidebarTabRowTokens(_ palette: Palette, isDark: Bool) {
    let row = palette.selectableRow
    let ink = isDark ? Color.white : .black
    let primarySelection = isDark ? Color.black : Color.white
    expectSameColor(
      row.restFill,
      ink.opacity(0.06),
      "sidebarTabRow.restFill"
    )
    expectSameColor(
      row.hoverFill,
      Color.white.opacity(isDark ? 0.16 : 0.55),
      "sidebarTabRow.hoverFill"
    )
    expectSameColor(
      row.pressedFill,
      Color.white.opacity(isDark ? 0.31 : 0.70),
      "sidebarTabRow.pressedFill"
    )
    expectSameColor(
      row.primarySelectionFill,
      primarySelection,
      "sidebarTabRow.primarySelectionFill"
    )
    expectSameColor(
      row.secondarySelectionFill,
      Color.white.opacity(isDark ? 0.25 : 0.70),
      "sidebarTabRow.secondarySelectionFill"
    )
    expectSameColor(
      row.selectedTitle,
      ink,
      "sidebarTabRow.selectedTitle"
    )
    expectSameColor(
      row.title,
      ink.opacity(isDark ? 0.78 : 0.68),
      "sidebarTabRow.title"
    )
    expectSameColor(
      row.shadow,
      ink.opacity(isDark ? 0.15 : 0.12),
      "sidebarTabRow.shadow"
    )
    expectSameColor(
      palette.sidebarTabRowSelectedEdgeStrong,
      Color.white.opacity(isDark ? 0.30 : 1),
      "sidebarTabRowSelectedEdgeStrong"
    )
    expectSameColor(
      palette.sidebarTabRowSelectedEdgeWeak,
      Color.white.opacity(isDark ? 0.15 : 1),
      "sidebarTabRowSelectedEdgeWeak"
    )
    expectSameThemeColor(
      palette.sidebarProjectStrokeValue,
      isDark
        ? ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10)
        : ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.10),
      "sidebarProjectStrokeValue"
    )
    expectSameColor(
      palette.sidebarSeparator,
      (isDark ? Color.white : .black).opacity(0.15),
      "sidebarSeparator"
    )
  }

  private func expectContrast(
    _ foreground: ThemeColor,
    _ background: ThemeColor,
    minimum: Double,
    token: String,
    sourceLocation: SourceLocation = #_sourceLocation
  ) {
    #expect(
      ColorMath.contrastRatio(foreground, background) >= minimum,
      "\(token): \(ColorMath.contrastRatio(foreground, background)) < \(minimum)",
      sourceLocation: sourceLocation
    )
  }
}

struct GrainTextureTests {
  @Test func tileIsDeterministic() {
    let first = GrainTexture.makeTile()
    let second = GrainTexture.makeTile()
    #expect(pixelBytes(of: first) == pixelBytes(of: second))
    #expect(pixelBytes(of: first) == pixelBytes(of: GrainTexture.tile))
  }

  @Test func tileDimensions() {
    #expect(GrainTexture.tile.width == 128)
    #expect(GrainTexture.tile.height == 128)
    #expect(GrainTexture.tile.bitsPerPixel == 32)
  }

  private func pixelBytes(of image: CGImage) -> Data {
    guard let data = image.dataProvider?.data else { return Data() }
    return data as Data
  }
}
