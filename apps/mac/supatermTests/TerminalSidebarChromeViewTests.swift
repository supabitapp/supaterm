import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func unreadCountTakesPrecedenceOverClaudeActivity() {
    let tab = TerminalTabItem(title: "Build", icon: nil)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 3,
        claudeActivity: .needsInput,
        terminalProgress: nil
      ) == .unreadCount(3)
    )
  }

  @Test
  func claudeActivityTakesPrecedenceOverDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 0,
        claudeActivity: .running,
        terminalProgress: nil
      ) == .claudeActivity(.running)
    )
  }

  @Test
  func claudeActivityTakesPrecedenceOverTerminalProgress() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer", isDirty: true)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: false,
        tab: tab,
        unreadCount: 0,
        claudeActivity: .running,
        terminalProgress: .init(fraction: 0.5, tone: .active)
      ) == .claudeActivity(.running)
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverFocusedNotification() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer", isDirty: true)
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 0,
        claudeActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func focusedNotificationTakesPrecedenceOverDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 0,
        claudeActivity: .idle,
        terminalProgress: nil
      ) == .focusedNotification
    )
  }

  @Test
  func claudeActivityPresentationUsesExpectedTonesAndVisibility() {
    #expect(TerminalHostState.ClaudeActivity.running.tone == .active)
    #expect(TerminalHostState.ClaudeActivity.running.showsLeadingIndicator)

    #expect(TerminalHostState.ClaudeActivity.needsInput.tone == .attention)
    #expect(TerminalHostState.ClaudeActivity.needsInput.showsLeadingIndicator)

    #expect(TerminalHostState.ClaudeActivity.idle.tone == .muted)
    #expect(!TerminalHostState.ClaudeActivity.idle.showsLeadingIndicator)
  }

  @Test
  func defaultTabSymbolIsUsedWithoutUnreadOrClaudeActivity() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: false,
        tab: tab,
        unreadCount: 0,
        claudeActivity: nil,
        terminalProgress: nil
      ) == .tabSymbol("hammer", .accent(tab.tone))
    )
  }

  @Test
  func genericTerminalSymbolUsesNeutralStyle() {
    let tab = TerminalTabItem(title: "Build", icon: "terminal")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: false,
        tab: tab,
        unreadCount: 0,
        claudeActivity: nil,
        terminalProgress: nil
      ) == .tabSymbol("terminal", .neutral)
    )
  }

  @Test
  func helpTextIncludesNotificationAndPaneDirectories() {
    #expect(
      TerminalSidebarTabSummaryView.helpText(
        latestNotificationText: "Build finished",
        paneWorkingDirectories: ["~/Downloads", "~/Downloads/abc"]
      ) == "Build finished\n~/Downloads\n~/Downloads/abc"
    )
  }
}
