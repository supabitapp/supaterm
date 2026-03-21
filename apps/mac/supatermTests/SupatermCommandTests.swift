import Testing

@testable import supaterm

struct SupatermCommandTests {
  @Test
  func mapsCommandsToGhosttyBindingActions() {
    #expect(SupatermCommand.newWindow.ghosttyBindingAction == "new_window")
    #expect(SupatermCommand.closeSurface.ghosttyBindingAction == "close_surface")
    #expect(SupatermCommand.goToTab(3).ghosttyBindingAction == "goto_tab:3")
    #expect(SupatermCommand.newSplit(.down).ghosttyBindingAction == "new_split:down")
    #expect(SupatermCommand.navigateSearch(.previous).ghosttyBindingAction == "navigate_search:previous")
  }
}
