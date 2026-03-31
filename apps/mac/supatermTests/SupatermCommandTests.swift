import Testing

@testable import supaterm

struct SupatermCommandTests {
  @Test
  func mapsCommandsToGhosttyBindingActions() {
    #expect(SupatermCommand.newWindow.ghosttyBindingAction == "new_window")
    #expect(SupatermCommand.closeSurface.ghosttyBindingAction == "close_surface")
    #expect(SupatermCommand.goToTab(3).ghosttyBindingAction == "goto_tab:3")
    #expect(SupatermCommand.goToSplit(.previous).ghosttyBindingAction == "goto_split:previous")
    #expect(SupatermCommand.newSplit(.down).ghosttyBindingAction == "new_split:down")
    #expect(SupatermCommand.resizeSplit(.right, 10).ghosttyBindingAction == "resize_split:right,10")
    #expect(SupatermCommand.navigateSearch(.previous).ghosttyBindingAction == "navigate_search:previous")
  }

  @Test
  func defaultTabShortcutsUseCommandDigitsOneThroughZero() {
    #expect(SupatermCommand.goToTab(1).defaultKeyboardShortcut?.display == "⌘1")
    #expect(SupatermCommand.goToTab(9).defaultKeyboardShortcut?.display == "⌘9")
    #expect(SupatermCommand.goToTab(10).defaultKeyboardShortcut?.display == "⌘0")
    #expect(SupatermCommand.lastTab.defaultKeyboardShortcut == nil)
  }
}
