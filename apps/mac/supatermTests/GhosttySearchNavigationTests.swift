import Testing

@testable import supaterm

struct GhosttySearchNavigationTests {
  @Test
  func directionsUseGhosttyNavigationBindings() {
    #expect(GhosttySearchDirection.next.bindingAction == "navigate_search:next")
    #expect(GhosttySearchDirection.previous.bindingAction == "navigate_search:previous")
  }

  @Test
  func closeSearchClearsSearchStateImmediately() {
    let bridge = GhosttySurfaceBridge()
    bridge.state.searchState = GhosttySurfaceSearchState(needle: "needle")

    bridge.closeSearch()

    #expect(bridge.state.searchState == nil)
  }
}
