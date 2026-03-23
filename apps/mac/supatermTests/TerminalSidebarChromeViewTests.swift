import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func unreadCountTakesPrecedenceOverClaudeActivity() {
    let tab = TerminalTabItem(title: "Build", icon: nil)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 3,
        claudeActivity: .needsInput
      ) == .unreadCount(3)
    )
  }

  @Test
  func claudeActivityTakesPrecedenceOverDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        claudeActivity: .running
      ) == .claudeActivity(.running)
    )
  }

  @Test
  func defaultTabSymbolIsUsedWithoutUnreadOrClaudeActivity() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        claudeActivity: nil
      ) == .tabSymbol("hammer", tab.tone)
    )
  }
}
