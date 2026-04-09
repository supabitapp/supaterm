import Testing

@testable import supaterm

struct GhosttySearchNavigationTests {
  @Test
  func directionsUseNavigateSearchBindings() {
    #expect(GhosttySearchDirection.next.command == .navigateSearch(.next))
    #expect(GhosttySearchDirection.previous.command == .navigateSearch(.previous))
  }

  @Test
  func navigationDefaultsToDirectCommand() {
    #expect(
      GhosttySearchNavigator.commands(
        direction: .next,
        selected: nil,
        total: nil
      ) == [.navigateSearch(.next)]
    )
    #expect(
      GhosttySearchNavigator.commands(
        direction: .previous,
        selected: nil,
        total: nil
      ) == [.navigateSearch(.previous)]
    )
  }
}
