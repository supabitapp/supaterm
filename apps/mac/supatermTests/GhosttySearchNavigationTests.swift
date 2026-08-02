import Testing

@testable import supaterm

struct GhosttySearchNavigationTests {
  @Test
  func eachDirectionUsesOneNativeSearchAction() {
    #expect(GhosttySearchDirection.next.command == .navigateSearch(.next))
    #expect(GhosttySearchDirection.previous.command == .navigateSearch(.previous))
  }
}
