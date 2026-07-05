import SwiftUI
import Testing

@testable import SupaTheme

struct ThemeTests {
  @Test func curatedThemesHaveUniqueIDs() {
    #expect(Set(Theme.curated.map(\.id)).count == Theme.curated.count)
  }

  @Test func defaultThemeIsIsabelline() {
    #expect(Theme.default == .isabelline)
    #expect(Theme.curated.first == .isabelline)
  }

  @Test func isabellineUsesOnePrimaryForBothAppearances() {
    #expect(Theme.isabelline.lightPrimary == Theme.isabelline.darkPrimary)
  }

  @Test func primaryFollowsColorScheme() {
    #expect(Theme.mint.primary(for: .light) == Theme.mint.lightPrimary)
    #expect(Theme.mint.primary(for: .dark) == Theme.mint.darkPrimary)
  }

  @Test func curatedLookupFallsBackToDefault() {
    #expect(Theme.curated(id: "steel-blue") == .steelBlue)
    #expect(Theme.curated(id: "nonexistent") == .default)
  }
}
