import Testing

@testable import supaterm

struct GhosttySearchNavigationTests {
  @Test
  func directionsUseNavigateSearchBindings() {
    #expect(GhosttySearchDirection.next.bindingAction == "navigate_search:next")
    #expect(GhosttySearchDirection.previous.bindingAction == "navigate_search:previous")
  }

  @Test
  func navigationDefaultsToDirectBindingAction() {
    #expect(
      GhosttySearchNavigator.bindingActions(
        direction: .next,
        selected: nil,
        total: nil
      ) == ["navigate_search:next"]
    )
    #expect(
      GhosttySearchNavigator.bindingActions(
        direction: .previous,
        selected: nil,
        total: nil
      ) == ["navigate_search:previous"]
    )
  }
}
