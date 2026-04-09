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
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func agentActivityAppearsWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil
      ) == .agentActivity(.claude(.running))
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverAgentActivity() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
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
  func quietTabShowsNoStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func shortcutHintOverridesStatusAccessory() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    #expect(
      TerminalSidebarTabSummaryView.titleAccessory(
        shortcutHint: "⌘1",
        showsShortcutHint: true,
        isRowHovering: false,
        statusAccessory: .terminalProgress(progress)
      ) == .shortcutHint("⌘1")
    )
  }

  @Test
  func rowHoverHidesStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.titleAccessory(
        shortcutHint: nil,
        showsShortcutHint: false,
        isRowHovering: true,
        statusAccessory: .unreadCount(2)
      ) == nil
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
  func githubPullRequestPresentationFormatsThePullRequestNumber() {
    let presentation = GithubPullRequestPresentation(
      snapshot: .init(
        number: 123,
        repositoryIdentity: .init(
          branch: "feature",
          repoRoot: "/tmp/project"
        ),
        url: URL(string: "https://github.com/supabitapp/supaterm/pull/123")!
      )
    )

    #expect(presentation.label == "PR #123")
    #expect(presentation.url.absoluteString == "https://github.com/supabitapp/supaterm/pull/123")
  }

  @Test
  func runningCodexDetailTakesSecondaryLinePrecedenceOverNotificationPreview() {
    #expect(
      TerminalSidebarTabSummaryView.secondaryContent(
        agentActivity: .codex(.running, detail: "Bash · git status --short"),
        showsAgentActivityDetail: true,
        notificationPreviewMarkdown: "Need approval"
      ) == .activity("Bash · git status --short")
    )
  }

  @Test
  func notificationPreviewReturnsWhenCodexNeedsInput() {
    #expect(
      TerminalSidebarTabSummaryView.secondaryContent(
        agentActivity: .codex(.needsInput, detail: "Bash · git status --short"),
        showsAgentActivityDetail: false,
        notificationPreviewMarkdown: "Need approval"
      ) == .notification("Need approval")
    )
  }

  @Test
  func notificationPreviewRemainsForNonCodexActivity() {
    #expect(
      TerminalSidebarTabSummaryView.secondaryContent(
        agentActivity: .claude(.running, detail: "Thinking"),
        showsAgentActivityDetail: false,
        notificationPreviewMarkdown: "Need approval"
      ) == .notification("Need approval")
    )
  }

  @Test
  func notificationPreviewReturnsWhenCodexDetailIsHiddenForBackgroundPane() {
    #expect(
      TerminalSidebarTabSummaryView.secondaryContent(
        agentActivity: .codex(.running, detail: "Bash · git status --short"),
        showsAgentActivityDetail: false,
        notificationPreviewMarkdown: "Need approval"
      ) == .notification("Need approval")
    )
  }

  @Test
  func secondaryContentIsNilWithoutActivityDetailOrNotificationPreview() {
    #expect(
      TerminalSidebarTabSummaryView.secondaryContent(
        agentActivity: .codex(.running),
        showsAgentActivityDetail: false,
        notificationPreviewMarkdown: nil
      ) == nil
    )
  }

  @Test
  func runningCodexDetailTakesPopoverPrecedenceOverNotificationMarkdown() {
    #expect(
      TerminalSidebarTabSummaryView.popoverMarkdown(
        agentActivity: .codex(.running, detail: "Inspecting transcript activity"),
        showsAgentActivityDetail: true,
        notificationMarkdown: """
          Need approval

          Full notification body
          """
      ) == "Inspecting transcript activity"
    )
  }

  @Test
  func notificationMarkdownReturnsWhenCodexDetailIsHiddenForPopover() {
    #expect(
      TerminalSidebarTabSummaryView.popoverMarkdown(
        agentActivity: .codex(.running, detail: "Inspecting transcript activity"),
        showsAgentActivityDetail: false,
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
  func popoverMarkdownIsNilWithoutVisibleActivityDetailOrNotification() {
    #expect(
      TerminalSidebarTabSummaryView.popoverMarkdown(
        agentActivity: .codex(.running),
        showsAgentActivityDetail: false,
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
