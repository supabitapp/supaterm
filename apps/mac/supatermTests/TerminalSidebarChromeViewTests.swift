import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func unreadCountTakesPrecedenceOverAgentActivity() {
    let tab = TerminalTabItem(title: "Build", icon: nil)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
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
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: .init(fraction: 0.5, tone: .active)
      ) == .agentActivity(.claude(.running))
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer", isDirty: true)
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func idleAgentFallsBackToDefaultTabSymbol() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer")

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.idle),
        terminalProgress: nil
      ) == .tabSymbol("hammer", .accent(tab.tone))
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

  @Test
  func notificationPopoverContentParsesInlineMarkdownAndPreservesWhitespace() throws {
    let content = try #require(
      TerminalSidebarTabSummaryView.notificationPopoverContent(
        latestNotificationText: """
          **Build**
          - `npm test`
          """
      )
    )

    #expect(
      String(content.characters) == """
        Build
        - npm test
        """
    )
    #expect(content.runs.contains { $0.inlinePresentationIntent == .stronglyEmphasized })
    #expect(content.runs.contains { $0.inlinePresentationIntent == .code })
  }

  @Test
  func notificationPopoverContentReturnsNilForBlankText() {
    #expect(
      TerminalSidebarTabSummaryView.notificationPopoverContent(
        latestNotificationText: "   "
      ) == nil
    )
  }

  @Test
  func shortcutHintsFollowVisibleTabOrderThroughSlotTen() {
    let tabs = (1...11).map { index in
      TerminalTabItem(title: "Tab \(index)", icon: nil)
    }

    let hints = TerminalSidebarTabShortcutHints.byTabID(for: tabs) { slot in
      SupatermCommand.goToTab(slot).defaultKeyboardShortcut
    }

    #expect(hints[tabs[0].id] == "⌘1")
    #expect(hints[tabs[8].id] == "⌘9")
    #expect(hints[tabs[9].id] == "⌘0")
    #expect(hints[tabs[10].id] == nil)
  }

  @Test
  func shortcutHintsUseProvidedVisibleOrder() {
    let first = TerminalTabItem(title: "First", icon: nil)
    let second = TerminalTabItem(title: "Second", icon: nil)
    let third = TerminalTabItem(title: "Third", icon: nil)

    let hints = TerminalSidebarTabShortcutHints.byTabID(for: [third, first, second]) { slot in
      SupatermCommand.goToTab(slot).defaultKeyboardShortcut
    }

    #expect(hints[third.id] == "⌘1")
    #expect(hints[first.id] == "⌘2")
    #expect(hints[second.id] == "⌘3")
  }
}
