import Foundation
import GhosttyKit
import Testing
import Textual

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func unreadCountTakesPrecedenceOverAgentActivity() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: .claude(.needsInput),
        terminalProgress: nil
      ) == .unreadCount(3)
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverUnreadCount() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverTerminalBell() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress,
        hasTerminalBell: true
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func unreadCountTakesPrecedenceOverTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .unreadCount(3)
    )
  }

  @Test
  func agentInputTakesPrecedenceOverTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .agentActivity(.codex(.needsInput))
    )
  }

  @Test
  func terminalBellTakesPrecedenceOverRunningAgentAndPinnedStatus() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: .codex(.running),
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .terminalBell
    )
  }

  @Test
  func agentActivityAppearsWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil
      ) == .agentActivity(.claude(.running))
    )
  }

  @Test
  func runningAgentActivityIsHiddenWhenAgentSpinnerIsHidden() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == nil
    )
  }

  @Test
  func hiddenAgentSpinnerFallsBackToPinnedStatus() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == .pinned
    )
  }

  @Test
  func agentInputStatusIgnoresAgentSpinnerSetting() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.needsInput),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == .agentActivity(.claude(.needsInput))
    )
  }

  @Test
  func focusedAgentInputStatusIsHidden() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        agentActivityIsFocused: true,
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func focusedAgentInputStatusFallsBackToTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        agentActivityIsFocused: true,
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .terminalBell
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverAgentActivity() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func terminalProgressAppearsWhenNoHigherPriorityStatusExists() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func idleAgentShowsNoStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.idle),
        terminalProgress: nil
      ) == nil
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
  func agentMarkPresentationUsesAgentKindAssetMapping() {
    #expect(
      TerminalSidebarTabSummaryView.agentMarkPresentation(
        for: TerminalHostState.AgentActivity(kind: .pi, phase: .idle)
      ) == "pi-mark-glyph"
    )
    #expect(
      TerminalSidebarTabSummaryView.agentMarkPresentation(
        for: .codex(.running)
      ) == "codex-mark"
    )
    #expect(
      TerminalSidebarTabSummaryView.agentMarkPresentation(
        for: .claude(.running)
      ) == "claude-code-mark"
    )
  }

  @Test
  func agentMarkPresentationIsNilWithoutAgentActivity() {
    #expect(TerminalSidebarTabSummaryView.agentMarkPresentation(for: nil) == nil)
  }

  @Test
  func agentMarkPresentationIsNilWhenAgentMarksAreHidden() {
    #expect(
      TerminalSidebarTabSummaryView.agentMarkPresentation(
        for: .claude(.running),
        showsAgentMarks: false
      ) == nil
    )
  }

  @Test
  func quietTabShowsNoStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func pinnedTabsShowPinnedStatusWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: nil
      ) == .pinned
    )
  }

  @Test
  func terminalProgressHidesPinnedStatus() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func titleAccessoriesShowShortcutHintAndPinnedStatusTogether() {
    let accessories = TerminalSidebarTabSummaryView.titleAccessories(
      shortcutHint: "⌘1",
      showsShortcutHint: true,
      isRowHovering: false,
      statusAccessory: .pinned
    )

    #expect(
      accessories
        == TerminalSidebarTabSummaryView.TitleAccessories(
          shortcutHint: "⌘1",
          statusAccessory: .pinned
        )
    )
  }

  @Test
  func rowHoverHidesStatusAccessoryButKeepsShortcutHint() {
    #expect(
      TerminalSidebarTabSummaryView.titleAccessories(
        shortcutHint: "⌘1",
        showsShortcutHint: true,
        isRowHovering: true,
        statusAccessory: .unreadCount(2)
      )
        == TerminalSidebarTabSummaryView.TitleAccessories(
          shortcutHint: "⌘1",
          statusAccessory: nil
        )
    )
  }

  @Test
  func titleAccessoriesShowShortcutHintAndProgressTogether() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    #expect(
      TerminalSidebarTabSummaryView.titleAccessories(
        shortcutHint: "⌘1",
        showsShortcutHint: true,
        isRowHovering: false,
        statusAccessory: .terminalProgress(progress)
      )
        == TerminalSidebarTabSummaryView.TitleAccessories(
          shortcutHint: "⌘1",
          statusAccessory: .terminalProgress(progress)
        )
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

  @Test
  func notificationMarkdownDrivesPopover() {
    #expect(
      TerminalSidebarTabSummaryView.popoverMarkdown(
        notificationMarkdown: """
          Need approval

          Full notification body
          """
      ) == """
        Need approval

        Full notification body
        """
    )
  }

  @Test
  func popoverMarkdownIsNilWithoutNotification() {
    #expect(
      TerminalSidebarTabSummaryView.popoverMarkdown(
        notificationMarkdown: nil
      ) == nil
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
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

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
  }

  @Test
  func pinnedTabContextMenuIncludesSavePanesLayout() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: true,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

    #expect(
      titles == [
        "New Tab",
        "Unpin Tab",
        "Change Tab Title...",
        "Save Panes Layout to Pinned Tab",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @MainActor
  @Test
  func focusedPaneIndeterminateProgressUsesActiveSpinner() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_INDETERMINATE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: nil, tone: .active)
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
        == TerminalSidebarTerminalProgress(fraction: 0.42, tone: .active)
    )
  }

  @MainActor
  @Test
  func focusedPanePausedProgressWithoutValueUsesFullRing() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_PAUSE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: 1, tone: .paused)
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
        == TerminalSidebarTerminalProgress(fraction: nil, tone: .error)
    )
  }

  @MainActor
  @Test
  func missingFocusedPaneStateProducesNoProgressRing() {
    #expect(TerminalHostState.sidebarTerminalProgress(state: nil) == nil)
  }
}
