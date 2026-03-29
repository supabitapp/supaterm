import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func unreadCountTakesPrecedenceOverAgentActivity() {
    let tab = TerminalTabItem(title: "Build", icon: nil)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 3,
        agentActivity: .claude(.needsInput),
        terminalProgress: nil
      ) == .unreadCount(3)
    )
  }

  @Test
  func agentActivityTakesPrecedenceOverDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil
      ) == .agentActivity(.claude(.running))
    )
  }

  @Test
  func agentActivityTakesPrecedenceOverTerminalProgress() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer", isDirty: true)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: false,
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: .init(fraction: 0.5, tone: .active)
      ) == .agentActivity(.claude(.running))
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
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func focusedNotificationTakesPrecedenceOverIdleAgentState() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: true,
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.idle),
        terminalProgress: nil
      ) == .focusedNotification
    )
  }

  @Test
  func agentActivityPresentationUsesExpectedTonesAndVisibility() {
    #expect(TerminalHostState.AgentActivity.claude(.running).tone == .active)
    #expect(TerminalHostState.AgentActivity.claude(.running).showsLeadingIndicator)

    #expect(TerminalHostState.AgentActivity.codex(.needsInput).tone == .attention)
    #expect(TerminalHostState.AgentActivity.codex(.needsInput).showsLeadingIndicator)

    #expect(TerminalHostState.AgentActivity.claude(.idle).tone == .muted)
    #expect(!TerminalHostState.AgentActivity.claude(.idle).showsLeadingIndicator)
  }

  @Test
  func defaultTabSymbolIsUsedWithoutUnreadOrAgentActivity() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        hasFocusedNotificationAttention: false,
        tab: tab,
        unreadCount: 0,
        agentActivity: nil,
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
        agentActivity: nil,
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
