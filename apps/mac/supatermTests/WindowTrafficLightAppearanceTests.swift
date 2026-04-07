import SwiftUI
import Testing

@testable import supaterm

struct WindowTrafficLightAppearanceTests {
  @Test
  func inactiveAppearanceUsesRingStyleInDarkMode() {
    let appearance = WindowTrafficLightAppearance.make(
      isHovering: false,
      colorScheme: .dark
    )

    #expect(appearance.fillOpacity == 0.2)
    #expect(appearance.strokeOpacity == 0.7)
    #expect(appearance.strokeLineWidth == 1)
    #expect(!appearance.showsSymbol)
    #expect(!appearance.usesAccentFill)
  }

  @Test
  func inactiveAppearanceUsesRingStyleInLightMode() {
    let appearance = WindowTrafficLightAppearance.make(
      isHovering: false,
      colorScheme: .light
    )

    #expect(appearance.fillOpacity == 0.14)
    #expect(appearance.strokeOpacity == 0.7)
    #expect(appearance.strokeLineWidth == 1)
    #expect(!appearance.showsSymbol)
    #expect(!appearance.usesAccentFill)
  }

  @Test
  func hoveredAppearanceUsesSolidAccentFillAndSymbols() {
    let appearance = WindowTrafficLightAppearance.make(
      isHovering: true,
      colorScheme: .dark
    )

    #expect(appearance.fillOpacity == 1)
    #expect(appearance.strokeOpacity == 0)
    #expect(appearance.strokeLineWidth == 0)
    #expect(appearance.showsSymbol)
    #expect(appearance.usesAccentFill)
  }
}
