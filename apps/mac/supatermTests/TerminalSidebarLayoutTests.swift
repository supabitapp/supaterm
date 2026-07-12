import Testing

@testable import supaterm

struct TerminalSidebarLayoutTests {
  @Test
  func spaceMonogramUsesFirstNonWhitespaceCharacter() {
    #expect(TerminalSidebarLayout.spaceMonogram(for: "  shell", fallbackIndex: 2) == "S")
  }

  @Test
  func spaceMonogramPreservesLeadingEmoji() {
    #expect(TerminalSidebarLayout.spaceMonogram(for: "  🚀 launch", fallbackIndex: 2) == "🚀")
  }

  @Test
  func spaceMonogramFallsBackToOrdinalForBlankName() {
    #expect(TerminalSidebarLayout.spaceMonogram(for: "   ", fallbackIndex: 2) == "3")
  }

  @Test
  func spaceListVisibilityTracksCount() {
    #expect(!TerminalSidebarLayout.showsSpaceList(spacesCount: 1))
    #expect(TerminalSidebarLayout.showsSpaceList(spacesCount: 2))
  }

  @Test
  func firstSectionClearsTrafficLights() {
    #expect(TerminalSidebarLayout.firstVisibleSectionTopInset > WindowTrafficLightMetrics.buttonSize)
  }
}
