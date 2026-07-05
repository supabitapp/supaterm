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
  private func expectLegacyTokens(_ palette: Palette, isDark: Bool) {
    let primary = Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925)
    let expectations: [(String, Color, Color)] = [
      (
        "windowBackgroundTint", palette.windowBackgroundTint,
        primary.mix(with: .black, by: isDark ? 0.8 : 0).opacity(0.3)
      ),
      ("unselectedFill", palette.unselectedFill, (isDark ? Color.white : .black).opacity(0.06)),
      ("hoverFill", palette.hoverFill, Color.white.opacity(isDark ? 0.16 : 0.55)),
      ("pressedFill", palette.pressedFill, Color.white.opacity(isDark ? 0.31 : 0.7)),
      ("selectedFill", palette.selectedFill, isDark ? Color(white: 0.04) : .white),
      (
        "selectedStrokeBright", palette.selectedStrokeBright,
        Color.white.opacity(isDark ? 0.35 : 0.98)
      ),
      ("selectedStrokeDim", palette.selectedStrokeDim, Color.white.opacity(isDark ? 0.08 : 0.98)),
      (
        "selectedShadow", palette.selectedShadow,
        isDark ? Color.white.opacity(0.15) : Color.black.opacity(0.12)
      ),
      ("selectedText", palette.selectedText, isDark ? Color.white : .black),
      (
        "selectedSecondaryText", palette.selectedSecondaryText,
        (isDark ? Color.white : .black).opacity(0.72)
      ),
      ("selectedPillFill", palette.selectedPillFill, (isDark ? Color.white : .black).opacity(0.12)),
      (
        "selectedPillStroke", palette.selectedPillStroke,
        (isDark ? Color.white : .black).opacity(0.14)
      ),
      (
        "detailStroke", palette.detailStroke,
        isDark ? Color.white.opacity(0.08) : Color.black.opacity(0.06)
      ),
      (
        "primaryText", palette.primaryText,
        isDark ? Color.white.opacity(0.94) : Color.black.opacity(0.86)
      ),
      (
        "secondaryText", palette.secondaryText,
        isDark ? Color.white.opacity(0.58) : Color.black.opacity(0.48)
      ),
      ("shadow", palette.shadow, Color.black.opacity(isDark ? 0.28 : 0.08)),
      ("scrim", palette.scrim, Color.black.opacity(0.4)),
      ("overlayShadow", palette.overlayShadow, Color.black.opacity(0.25)),
      ("divider", palette.divider, Color.white.opacity(0.3)),
      ("destructive", palette.destructive, Color(red: 1, green: 0.4118, blue: 0.4118)),
      (
        "destructiveHoverFill", palette.destructiveHoverFill,
        Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85)
      ),
      ("attention", palette.attention, Color(nsColor: .systemOrange)),
      ("success", palette.success, Color(nsColor: .systemGreen)),
      (
        "detailBackground", palette.detailBackground,
        primary.mix(with: isDark ? .black : .white, by: 0.85)
      ),
      ("amber", palette.amber, Color(red: 0.89, green: 0.64, blue: 0.28)),
      ("mint", palette.mint, Color(red: 0.3, green: 0.72, blue: 0.58)),
      ("sky", palette.sky, Color(red: 0.31, green: 0.59, blue: 0.94)),
      ("coral", palette.coral, Color(red: 0.9, green: 0.43, blue: 0.38)),
      ("violet", palette.violet, Color(red: 0.57, green: 0.45, blue: 0.86)),
      ("slate", palette.slate, Color(red: 0.38, green: 0.44, blue: 0.56)),
      ("accent", palette.accent, Color(red: 0.31, green: 0.59, blue: 0.94)),
    ]
    for (token, actual, expected) in expectations {
      expectSameColor(actual, expected, token)
    }
  }

  @Test func defaultThemeLightMatchesLegacyPalette() {
    expectLegacyTokens(Palette(colorScheme: .light), isDark: false)
  }

  @Test func defaultThemeDarkMatchesLegacyPalette() {
    expectLegacyTokens(Palette(colorScheme: .dark), isDark: true)
  }

  @Test func toneFillsMatchLegacyPalette() {
    let palette = Palette(colorScheme: .light)
    expectSameColor(
      palette.fill(for: .amber), Color(red: 0.89, green: 0.64, blue: 0.28).opacity(0.85), "amber"
    )
    expectSameColor(
      palette.fill(for: .slate), Color(red: 0.38, green: 0.44, blue: 0.56).opacity(0.85), "slate"
    )
  }
}

struct PalettePolarityTests {
  @Test func brightSeedTakesDarkForeground() {
    let palette = Palette(theme: .hunyadiYellow, colorScheme: .light)
    #expect(palette.usesDarkForeground)
    expectSameColor(palette.primaryText, Color.black.opacity(0.86), "primaryText")
  }

  @Test func dimSeedTakesLightForeground() {
    let palette = Palette(theme: .steelBlue, colorScheme: .light)
    #expect(!palette.usesDarkForeground)
    expectSameColor(palette.primaryText, Color.white.opacity(0.94), "primaryText")
  }

  @Test func darkSchemeSurfaceTakesLightForeground() {
    for theme in Theme.curated {
      #expect(!Palette(theme: theme, colorScheme: .dark).usesDarkForeground, "\(theme.id)")
    }
  }
}
