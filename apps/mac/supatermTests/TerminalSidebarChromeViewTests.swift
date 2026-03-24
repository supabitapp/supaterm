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
  func idleClaudeActivityFallsBackToDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        claudeActivity: .idle
      ) == .tabSymbol("hammer", tab.tone)
    )
  }

  @Test
  func claudeActivityPresentationUsesExpectedLabelsAndSymbols() {
    #expect(TerminalHostState.ClaudeActivity.running.statusLabel == "Claude running")
    #expect(TerminalHostState.ClaudeActivity.running.symbolName == "bolt.fill")
    #expect(TerminalHostState.ClaudeActivity.running.tone == .active)
    #expect(TerminalHostState.ClaudeActivity.running.showsLeadingIndicator)

    #expect(TerminalHostState.ClaudeActivity.needsInput.statusLabel == "Claude needs input")
    #expect(TerminalHostState.ClaudeActivity.needsInput.symbolName == "bell.fill")
    #expect(TerminalHostState.ClaudeActivity.needsInput.tone == .attention)
    #expect(TerminalHostState.ClaudeActivity.needsInput.showsLeadingIndicator)

    #expect(TerminalHostState.ClaudeActivity.idle.statusLabel == "Claude idle")
    #expect(TerminalHostState.ClaudeActivity.idle.symbolName == "pause.circle.fill")
    #expect(TerminalHostState.ClaudeActivity.idle.tone == .muted)
    #expect(!TerminalHostState.ClaudeActivity.idle.showsLeadingIndicator)
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
