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

private func triTone(
  primary: (UInt32, UInt32),
  secondary: (UInt32, UInt32),
  tertiary: (UInt32, UInt32),
  vibrant: (UInt32, UInt32)
) -> ReferenceTriTone {
  ReferenceTriTone(
    primary: ReferenceTone(light: ThemeColor(hex: primary.0), dark: ThemeColor(hex: primary.1)),
    secondary: ReferenceTone(light: ThemeColor(hex: secondary.0), dark: ThemeColor(hex: secondary.1)),
    tertiary: ReferenceTone(light: ThemeColor(hex: tertiary.0), dark: ThemeColor(hex: tertiary.1)),
    vibrant: ReferenceTone(light: ThemeColor(hex: vibrant.0), dark: ThemeColor(hex: vibrant.1))
  )
}

private func hueDelta(_ first: ColorMath.OKLCH, _ second: ColorMath.OKLCH) -> Double {
  abs(atan2(sin(first.hue - second.hue), cos(first.hue - second.hue)))
}

@MainActor
struct ChromePaletteTests {
  @Test
  func referenceFamiliesMatchObservedTriToneValues() {
    let expected: [(ThemeTint, ReferenceTriTone)] = [
      (
        .neutral,
        triTone(
          primary: (0xCE6E3E, 0xFA2AA9),
          secondary: (0x6DDC3D, 0xE4E4E4),
          tertiary: (0x3101E0, 0x7F5F4F),
          vibrant: (0x000000, 0xFFFFFF)
        )
      ),
      (
        .red,
        triTone(
          primary: (0xC5751C, 0x55A4CC),
          secondary: (0x890DCF, 0x02E236),
          tertiary: (0x237191, 0x9C9C7E),
          vibrant: (0xB323FF, 0xB000FF)
        )
      ),
      (
        .orange,
        triTone(
          primary: (0x94278D, 0x52159C),
          secondary: (0x1B1DFF, 0xA15256),
          tertiary: (0x92D063, 0xBB8DBE),
          vibrant: (0x0026FF, 0x0088FF)
        )
      ),
      (
        .yellow,
        triTone(
          primary: (0x83CA3E, 0x00489C),
          secondary: (0x0C6E9F, 0xE17306),
          tertiary: (0xB0B044, 0x3BFD7F),
          vibrant: (0x008CFF, 0x008CFF)
        )
      ),
      (
        .green,
        triTone(
          primary: (0x984BE3, 0xD5B800),
          secondary: (0xDA8E8C, 0xD44500),
          tertiary: (0x429200, 0x3BFC1C),
          vibrant: (0x3BFF03, 0x2AFF00)
        )
      ),
      (
        .pink,
        triTone(
          primary: (0xB8B73D, 0xB655DB),
          secondary: (0x0F5D4D, 0x1805E4),
          tertiary: (0x534183, 0xADECBD),
          vibrant: (0xFAEAFF, 0x3717FC)
        )
      ),
      (
        .blue,
        triTone(
          primary: (0x4C88A3, 0xDBF700),
          secondary: (0x9EFEFC, 0x362400),
          tertiary: (0x3380B0, 0x4F2E1D),
          vibrant: (0xFF4C20, 0xFF4C20)
        )
      ),
      (
        .purple,
        triTone(
          primary: (0xE9B5F5, 0x5AD526),
          secondary: (0xFBEB2E, 0x34F265),
          tertiary: (0x3380B0, 0xAD9CAC),
          vibrant: (0xFF789D, 0xFF043C)
        )
      ),
    ]

    for (tint, expectedTriTone) in expected {
      #expect(tint.triTone(in: .default) == expectedTriTone, "\(tint.rawValue)")
      #expect(tint.tone(in: .default) == expectedTriTone.primary, "\(tint.rawValue)")
    }
  }

  @Test
  func lightNeutralUsesTheSixObservedGradientStops() {
    let palette = Palette(colorScheme: .light)
    let expected = [
      ThemeColor(hex: 0xFFFFFF),
      ThemeColor(hex: 0xFFFADB),
      ThemeColor(hex: 0xF0A775),
      ThemeColor(hex: 0xA869A3),
      ThemeColor(hex: 0x8660EF),
      ThemeColor(hex: 0x4160FF),
    ]

    #expect(palette.backgroundGradientStops == expected)
    expectSameThemeColor(palette.backgroundTopValue, expected[0], "backgroundTop")
    expectSameThemeColor(palette.backgroundBottomValue, expected[5], "backgroundBottom")
  }

  @Test
  func darkNeutralUsesTheWindowBackgroundOverlayAcrossTheGradient() {
    let palette = Palette(colorScheme: .dark)
    let expected = Array(repeating: ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.5), count: 6)

    #expect(palette.backgroundGradientStops == expected)
    expectSameColor(palette.windowBackgroundTint, Color.black.opacity(0.5), "windowBackgroundTint")
    expectSameThemeColor(palette.agentPanelBackgroundValue, expected[0], "agentPanelBackground")
  }

  @Test
  func chromaticGradientUsesTheTriToneSequence() {
    for colorScheme in [ColorScheme.light, .dark] {
      for tint in ThemeTint.chromatic {
        let palette = Palette(colorScheme: colorScheme, tint: tint)
        let colors = tint.triTone(in: .default)
        let expected = [
          colors.primary.color(for: colorScheme),
          colors.secondary.color(for: colorScheme),
          colors.tertiary.color(for: colorScheme),
          colors.vibrant.color(for: colorScheme),
          colors.secondary.color(for: colorScheme),
          colors.primary.color(for: colorScheme),
        ]
        #expect(palette.backgroundGradientStops == expected, "\(tint.rawValue)")
      }
    }
  }

  @Test
  func titlesKeepThePrimaryHueAcrossLightTintFamilies() {
    for tint in ThemeTint.chromatic {
      let palette = Palette(colorScheme: .light, tint: tint)
      let title = ColorMath.oklch(from: palette.spaceTitleValue)
      let primary = tint.tone(in: .default).light
      let source = ColorMath.oklch(from: primary)

      expectSameThemeColor(palette.spaceTitleValue, primary, "spaceTitle-\(tint.rawValue)")
      #expect(hueDelta(title, source) < 0.0001, "\(tint.rawValue)")
      #expect(title.chroma > 0.01, "\(tint.rawValue)")
    }
  }

  @Test
  func darkAndNeutralTitlesUseTheReferenceForegroundRules() {
    let neutralLight = Palette(colorScheme: .light)
    let neutralDark = Palette(colorScheme: .dark)
    expectSameThemeColor(neutralLight.spaceTitleValue, neutralLight.primaryTextValue, "neutralLightTitle")
    expectSameThemeColor(neutralDark.spaceTitleValue, neutralDark.primaryTextValue, "neutralDarkTitle")

    for tint in ThemeTint.chromatic {
      let palette = Palette(colorScheme: .dark, tint: tint)
      expectSameThemeColor(
        palette.spaceTitleValue,
        tint.tone(in: .default).dark,
        "spaceTitle-\(tint.rawValue)"
      )
    }
  }

  @Test
  func semanticRolesUseTheRenderedTriToneSources() {
    for colorScheme in [ColorScheme.light, .dark] {
      for tint in ThemeTint.allCases {
        let palette = Palette(colorScheme: colorScheme, tint: tint)
        let colors = tint.triTone(in: .default)
        expectSameThemeColor(palette.accentValue, colors.primary.color(for: colorScheme), "accent-\(tint.rawValue)")
        expectSameThemeColor(palette.warningValue, colors.secondary.color(for: colorScheme), "warning-\(tint.rawValue)")
        expectSameThemeColor(palette.successValue, colors.tertiary.color(for: colorScheme), "success-\(tint.rawValue)")
        expectSameThemeColor(palette.dangerValue, colors.vibrant.color(for: colorScheme), "danger-\(tint.rawValue)")
        expectSameThemeColor(palette.mergedValue, colors.secondary.color(for: colorScheme), "merged-\(tint.rawValue)")
        expectSameThemeColor(palette.queuedValue, colors.tertiary.color(for: colorScheme), "queued-\(tint.rawValue)")
      }
    }
  }

  @Test
  func semanticFillsUseTheObservedAlphaLadder() {
    for colorScheme in [ColorScheme.light, .dark] {
      let palette = Palette(colorScheme: colorScheme, tint: .blue)
      let alpha = colorScheme == .dark ? 1.0 : 0.9
      let hoverAlpha = colorScheme == .dark ? 1.0 : 0.8
      #expect(palette.warningFillValue.alpha == alpha)
      #expect(palette.dangerFillValue.alpha == alpha)
      #expect(palette.dangerHoverFillValue.alpha == hoverAlpha)
      expectSameThemeColor(palette.onWarningFillValue, colorScheme == .dark ? .white : .black, "onWarningFill")
      expectSameThemeColor(palette.onDangerFillValue, colorScheme == .dark ? .white : .black, "onDangerFill")
    }
  }

  @Test
  func renderedCompositeUsesOneGradientLayerAndTheMaterialBackdrop() {
    let view = ChromeBackgroundNSView()
    let palette = Palette(colorScheme: .light, tint: .blue)

    view.apply(palette)

    #expect(view.subviews == [view.effectView, view.baseRampView, view.grainView])
    #expect(view.baseRampView.gradientLayer?.colors as? [CGColor] == palette.backgroundGradientStops.map(\.cgColor))
    #expect(view.baseRampView.gradientLayer?.locations == ChromeBackgroundRamp.locations.map(NSNumber.init(value:)))
    #expect(view.grainView.layer?.backgroundColor != nil)
  }

  @Test
  func retintingKeepsTheSchemeAndRebuildsTheSamePalette() {
    for colorScheme in [ColorScheme.light, .dark] {
      let palette = Palette(colorScheme: colorScheme, tint: .blue).tinted(.green)
      let expected = Palette(colorScheme: colorScheme, tint: .green)
      #expect(palette.colorScheme == colorScheme)
      #expect(palette.tint == .green)
      #expect(palette.backgroundGradientStops == expected.backgroundGradientStops)
      expectSameThemeColor(palette.accentValue, expected.accentValue, "accent")
      expectSameThemeColor(palette.spaceTitleValue, expected.spaceTitleValue, "spaceTitle")
    }
  }

  @Test
  func selectionTokensUseThePrimaryAndInverseAlphaSteps() {
    for colorScheme in [ColorScheme.light, .dark] {
      let palette = Palette(colorScheme: colorScheme)
      let ink = colorScheme == .dark ? ThemeColor.white : .black
      let inverse = colorScheme == .dark ? ThemeColor.black : .white
      expectSameColor(palette.unselectedFill, ink.color.opacity(0.05), "unselectedFill")
      expectSameColor(palette.hoverFill, inverse.color.opacity(0.07), "hoverFill")
      expectSameColor(palette.pressedFill, inverse.color.opacity(0.12), "pressedFill")
      let selectedFill = colorScheme == .dark ? Color(white: 0.04) : inverse.color
      expectSameColor(palette.selectedFill, selectedFill, "selectedFill")
      expectSameColor(palette.selectedSecondaryText, palette.selectedText.opacity(0.72), "selectedSecondaryText")
      expectSameColor(palette.selectedPillFill, palette.selectedText.opacity(0.12), "selectedPillFill")
      expectSameColor(palette.selectedPillStroke, palette.selectedText.opacity(0.14), "selectedPillStroke")
      expectSameColor(palette.sidebarSeparator, ink.color.opacity(0.12), "sidebarSeparator")
    }
  }

  @Test
  func colorMathComputesContrastAndReadableForeground() {
    #expect(abs(ColorMath.contrastRatio(.black, .white) - 21) < 0.0001)
    expectSameThemeColor(ColorMath.readableForeground(on: .black), .white, "blackForeground")
    expectSameThemeColor(ColorMath.readableForeground(on: .white), .black, "whiteForeground")
  }

  @Test
  func perceptualMixInterpolatesInOKLab() {
    let mixed = ColorMath.perceptualMix(ThemeColor(hex: 0x2F7EC8), ThemeColor(hex: 0xF0C766), by: 0.36 / 0.54)
    expectSameThemeColor(mixed, ThemeColor(hex: 0xB4B294), "clearSunriseMidpoint", tolerance: 0.003)
  }

  @Test
  func oklchRoundTripsRepresentativeColors() {
    for color in [
      ThemeColor(hex: 0x3A88C4),
      ThemeColor(hex: 0xC98400),
      ThemeColor(hex: 0xE3E6EC),
    ] {
      let roundTrip = ColorMath.color(from: ColorMath.oklch(from: color))
      expectSameThemeColor(roundTrip, color, "roundTrip", tolerance: 0.00001)
    }
  }

  @Test
  func clampedOklchColorStaysDisplayable() {
    let color = ColorMath.clampedColor(
      from: ColorMath.OKLCH(lightness: 0.65, chroma: 0.5, hue: 0.2)
    )
    #expect(color.red >= 0 && color.red <= 1)
    #expect(color.green >= 0 && color.green <= 1)
    #expect(color.blue >= 0 && color.blue <= 1)
  }
}

struct GrainTextureTests {
  @Test
  func tileIsDeterministic() {
    let first = GrainTexture.makeTile()
    let second = GrainTexture.makeTile()
    #expect(pixelBytes(of: first) == pixelBytes(of: second))
    #expect(pixelBytes(of: first) == pixelBytes(of: GrainTexture.tile))
  }

  @Test
  func tileDimensions() {
    #expect(GrainTexture.tile.width == 128)
    #expect(GrainTexture.tile.height == 128)
    #expect(GrainTexture.tile.bitsPerPixel == 32)
  }

  private func pixelBytes(of image: CGImage) -> Data {
    guard let data = image.dataProvider?.data else { return Data() }
    return data as Data
  }
}
