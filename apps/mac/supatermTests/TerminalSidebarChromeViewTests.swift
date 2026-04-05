import AppKit
import Foundation
import GhosttyKit
import Testing
import Textual

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
  func terminalProgressTakesPrecedenceOverUnreadCount() {
    let tab = TerminalTabItem(title: "Build", icon: nil, isDirty: true)
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
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
  func terminalProgressTakesPrecedenceOverAgentActivity() {
    let tab = TerminalTabItem(title: "Build", icon: "hammer", isDirty: true)
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.leadingIndicator(
        tab: tab,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: progress
      ) == .terminalProgress(progress)
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
  func helpTextIncludesPaneDirectoriesOnly() {
    #expect(
      TerminalSidebarTabSummaryView.helpText(
        paneWorkingDirectories: ["~/Downloads", "~/Downloads/abc"]
      ) == "~/Downloads\n~/Downloads/abc"
    )
  }

  @MainActor
  @Test
  func notificationPopoverParserReturnsPartialDocumentForInvalidMarkdown() throws {
    let output = try SidebarNotificationMarkdown.popoverParser.attributedString(
      for: """
        # Project Notes

        Here's a broken link [Docs](https://supaterm.com
        and the rest of the document should still render.
        """
    )

    #expect(!String(output.characters).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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

  @Test
  func tabContextMenuIncludesChangeTabTitle() {
    let items = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true,
      selectedCount: 1
    )
    let titles = items.compactMap(\.title)

    #expect(
      titles == [
        "New Tab",
        "Pin Tab",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
    #expect(items.filter { $0.title != nil }.map(\.isEnabled) == [true, true, true, true, true, true])
  }

  @Test
  func multiTabContextMenuDisablesSingleTabActionsAndUsesBatchCloseTitle() {
    let items = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true,
      selectedCount: 2
    )

    #expect(
      items.compactMap(\.title) == [
        "New Tab",
        "Pin Tab",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close Selected Tabs",
      ])
    #expect(items.filter { $0.title != nil }.map(\.isEnabled) == [true, false, false, false, false, true])
  }

  @MainActor
  @Test
  func sidebarDragSourceDoesNotConsumeHitTesting() {
    let view = TerminalSidebarDragSourceNSView(frame: NSRect(x: 0, y: 0, width: 120, height: 36))

    #expect(view.hitTest(NSPoint(x: 12, y: 12)) == nil)
  }

  @MainActor
  @Test
  func focusedPaneIndeterminateProgressUsesActiveSpinner() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_INDETERMINATE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == .init(fraction: nil, tone: .active)
    )
  }

  @MainActor
  @Test
  func focusedPaneDeterminateProgressUsesFraction() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_SET
    state.progressValue = 42

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == .init(fraction: 0.42, tone: .active)
    )
  }

  @MainActor
  @Test
  func focusedPanePausedProgressWithoutValueUsesFullRing() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_PAUSE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == .init(fraction: 1, tone: .paused)
    )
  }

  @Test
  func pausedProgressUsesPauseIconIndicator() {
    let progress = TerminalSidebarTerminalProgress(fraction: 1, tone: .paused)

    #expect(progress.indicatorStyle == .pauseIcon)
  }

  @MainActor
  @Test
  func focusedPaneErrorProgressWithoutValueUsesErrorSpinner() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_ERROR

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == .init(fraction: nil, tone: .error)
    )
  }

  @MainActor
  @Test
  func missingFocusedPaneStateProducesNoProgressRing() {
    #expect(TerminalHostState.sidebarTerminalProgress(state: nil) == nil)
  }
}
