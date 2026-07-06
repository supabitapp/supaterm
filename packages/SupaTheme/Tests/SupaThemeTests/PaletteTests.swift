import SwiftUI
import Testing

@testable import SupaTheme

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

struct PaletteTokenTests {
  private func expectDefaultTokens(_ palette: Palette, isDark: Bool) {
    let primary = Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925)
    expectSameColor(
      palette.windowBackgroundTint,
      primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3),
      "windowBackgroundTint"
    )
    expectSameColor(
      palette.unselectedFill, (isDark ? Color.white : .black).opacity(0.06), "unselectedFill"
    )
    expectSameColor(palette.hoverFill, Color.white.opacity(isDark ? 0.16 : 0.55), "hoverFill")
    expectSameColor(palette.pressedFill, Color.white.opacity(isDark ? 0.31 : 0.7), "pressedFill")
    expectSameColor(palette.selectedFill, isDark ? Color(white: 0.04) : .white, "selectedFill")
    expectSameColor(
      palette.selectedStrokeBright, Color.white.opacity(isDark ? 0.35 : 0.98),
      "selectedStrokeBright"
    )
    expectSameColor(
      palette.selectedStrokeDim, Color.white.opacity(isDark ? 0.08 : 0.98), "selectedStrokeDim"
    )
    expectSameColor(
      palette.selectedShadow,
      isDark ? Color.white.opacity(0.15) : Color.black.opacity(0.12),
      "selectedShadow"
    )
    expectSameColor(palette.selectedText, isDark ? Color.white : .black, "selectedText")
    expectSameColor(
      palette.selectedSecondaryText, (isDark ? Color.white : .black).opacity(0.72),
      "selectedSecondaryText"
    )
    expectSameColor(
      palette.selectedPillFill, (isDark ? Color.white : .black).opacity(0.12), "selectedPillFill"
    )
    expectSameColor(
      palette.selectedPillStroke, (isDark ? Color.white : .black).opacity(0.14),
      "selectedPillStroke"
    )
    expectSameColor(
      palette.detailStroke,
      isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06),
      "detailStroke"
    )
    expectSameColor(
      palette.primaryText,
      isDark ? Color.white.opacity(0.94) : Color.black.opacity(0.86),
      "primaryText"
    )
    expectSameColor(
      palette.secondaryText,
      isDark ? Color.white.opacity(0.58) : Color.black.opacity(0.48),
      "secondaryText"
    )
    expectSameColor(palette.shadow, Color.black.opacity(isDark ? 0.28 : 0.08), "shadow")
    expectSameColor(palette.scrim, Color.black.opacity(0.4), "scrim")
    expectSameColor(palette.overlayShadow, Color.black.opacity(0.25), "overlayShadow")
    expectSameColor(palette.divider, Color.white.opacity(0.3), "divider")
    expectSameColor(palette.destructive, Color(red: 1, green: 0.4118, blue: 0.4118), "destructive")
    expectSameColor(
      palette.destructiveHoverFill,
      Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85),
      "destructiveHoverFill"
    )
    expectSameColor(palette.attention, Color(nsColor: .systemOrange), "attention")
    expectSameColor(palette.success, Color(nsColor: .systemGreen), "success")
    expectSameColor(
      palette.detailBackground,
      primary.mix(with: isDark ? .black : .white, by: 0.85),
      "detailBackground"
    )
    expectSameColor(palette.amber, Color(red: 0.89, green: 0.64, blue: 0.28), "amber")
    expectSameColor(palette.mint, Color(red: 0.3, green: 0.72, blue: 0.58), "mint")
    expectSameColor(palette.sky, Color(red: 0.31, green: 0.59, blue: 0.94), "sky")
    expectSameColor(palette.coral, Color(red: 0.9, green: 0.43, blue: 0.38), "coral")
    expectSameColor(palette.violet, Color(red: 0.57, green: 0.45, blue: 0.86), "violet")
    expectSameColor(palette.slate, Color(red: 0.38, green: 0.44, blue: 0.56), "slate")
    expectSameColor(palette.accent, Color(red: 0.31, green: 0.59, blue: 0.94), "accent")
  }

  @Test func defaultThemeLightMatchesExpectedPalette() {
    expectDefaultTokens(Palette(colorScheme: .light), isDark: false)
  }

  @Test func defaultThemeDarkMatchesExpectedPalette() {
    expectDefaultTokens(Palette(colorScheme: .dark), isDark: true)
  }
}

struct PaletteForegroundTests {
  @Test func lightSchemeTakesDarkForegroundForEveryTheme() {
    for theme in Theme.curated {
      let palette = Palette(theme: theme, colorScheme: .light)
      expectSameColor(palette.primaryText, Color.black.opacity(0.86), theme.id)
      expectSameColor(palette.secondaryText, Color.black.opacity(0.48), theme.id)
      expectSameColor(palette.detailStroke, Color.black.opacity(0.06), theme.id)
    }
  }

  @Test func darkSchemeTakesLightForegroundForEveryTheme() {
    for theme in Theme.curated {
      let palette = Palette(theme: theme, colorScheme: .dark)
      expectSameColor(palette.primaryText, Color.white.opacity(0.94), theme.id)
      expectSameColor(palette.secondaryText, Color.white.opacity(0.58), theme.id)
      expectSameColor(palette.detailStroke, Color.white.opacity(0.08), theme.id)
    }
  }
}
