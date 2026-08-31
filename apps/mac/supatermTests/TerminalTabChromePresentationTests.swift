import AppKit
import QuartzCore
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct TerminalTabChromePresentationTests {
  @Test
  func horizontalTitlePrefersLockedTabTitle() {
    let tab = TerminalTabItem(title: "Release", isTitleLocked: true)
    let presentation = TerminalTabChromePresentation(
      panes: [pane(title: "Focused pane", isFocused: true)],
      progress: nil
    )

    #expect(presentation.horizontalTitle(for: tab) == "Release")
  }

  @Test
  func horizontalTitlePrefersFocusedPane() {
    let tab = TerminalTabItem(title: "Fallback")
    let presentation = TerminalTabChromePresentation(
      panes: [
        pane(title: "First pane"),
        pane(title: "Focused pane", isFocused: true),
      ],
      progress: nil
    )

    #expect(presentation.horizontalTitle(for: tab) == "Focused pane")
  }

  @Test
  func horizontalTitleFallsBackThroughFirstPaneAndTab() {
    let tab = TerminalTabItem(title: "Fallback")
    let panePresentation = TerminalTabChromePresentation(
      panes: [pane(title: "First pane")],
      progress: nil
    )

    #expect(panePresentation.horizontalTitle(for: tab) == "First pane")
    #expect(TerminalTabChromePresentation.empty.horizontalTitle(for: tab) == "Fallback")
  }

  @Test
  func horizontalAccessibilityTitleListsLockedTitleThenEveryPane() {
    let lockedTab = TerminalTabItem(title: "Release", isTitleLocked: true)
    let unlockedTab = TerminalTabItem(title: "Fallback")
    let presentation = TerminalTabChromePresentation(
      panes: [
        pane(title: "First pane"),
        pane(title: "Second pane", isFocused: true),
      ],
      progress: nil
    )

    #expect(
      presentation.horizontalAccessibilityTitle(for: lockedTab)
        == "Release/First pane/Second pane"
    )
    #expect(
      presentation.horizontalAccessibilityTitle(for: unlockedTab)
        == "First pane/Second pane"
    )
    #expect(
      TerminalTabChromePresentation.empty.horizontalAccessibilityTitle(for: unlockedTab)
        == "Fallback"
    )
  }

  @Test
  func horizontalAccessibilityTitleOmitsRepeatedPaneTitles() {
    let tab = TerminalTabItem(title: "Release", isTitleLocked: true)
    let presentation = TerminalTabChromePresentation(
      panes: [
        pane(title: "Release"),
        pane(title: "Logs"),
        pane(title: "Release"),
      ],
      progress: nil
    )

    #expect(presentation.horizontalAccessibilityTitle(for: tab) == "Release/Logs")
  }

  @Test
  func horizontalTrailingStatusUsesFixedPriority() {
    let progress = TerminalTabProgress(fraction: 0.5, tone: .active)
    let tab = TerminalTabItem(title: "Build", isDirty: true)
    let attentionPane = pane(title: "Build", indicator: .attention)

    #expect(
      TerminalTabChromePresentation(panes: [attentionPane], progress: progress)
        .horizontalTrailingStatus(for: tab, isPinned: true) == .progress(progress)
    )
    #expect(
      TerminalTabChromePresentation(panes: [attentionPane], progress: nil)
        .horizontalTrailingStatus(for: tab, isPinned: true) == .attention
    )
    #expect(
      TerminalTabChromePresentation.empty
        .horizontalTrailingStatus(for: tab, isPinned: true) == .pinned
    )
    #expect(
      TerminalTabChromePresentation.empty
        .horizontalTrailingStatus(for: tab, isPinned: false) == .dirty
    )
    #expect(
      TerminalTabChromePresentation.empty.horizontalTrailingStatus(
        for: TerminalTabItem(title: "Clean"),
        isPinned: false
      ) == nil
    )
  }

  @Test
  func horizontalAgentStatusUsesHighestPanePriority() {
    let presentation = TerminalTabChromePresentation(
      panes: [
        pane(title: "Needs input", indicator: .agent(.needsInput)),
        pane(title: "Attention", indicator: .attention),
        pane(title: "Done", indicator: .agent(.done)),
        pane(title: "Working", indicator: .agent(.working)),
      ],
      progress: nil
    )

    #expect(presentation.horizontalAgentStatus == .needsInput)
    #expect(TerminalTabChromePresentation.empty.horizontalAgentStatus == nil)
  }

  @Test
  func horizontalStatusDescriptionsExposeStateAndProgress() {
    #expect(
      TerminalHorizontalTabTrailingStatus.attention.accessibilityDescription == "Needs attention")
    #expect(TerminalHorizontalTabTrailingStatus.pinned.accessibilityDescription == "Pinned")
    #expect(TerminalHorizontalTabTrailingStatus.dirty.accessibilityDescription == "Unsaved changes")
    #expect(
      TerminalHorizontalTabTrailingStatus.progress(
        TerminalTabProgress(fraction: 0.426, tone: .paused)
      ).accessibilityDescription == "Progress paused, 43 percent"
    )
    #expect(
      TerminalHorizontalTabTrailingStatus.progress(
        TerminalTabProgress(fraction: nil, tone: .error)
      ).accessibilityDescription == "Progress error"
    )
  }

  @Test
  func attentionAndDirtyKeepTheirSevenPointPathsAfterLayout() throws {
    let view = TerminalHorizontalTabStatusView(
      frame: CGRect(x: 0, y: 0, width: 22, height: 22)
    )
    let palette = Palette(colorScheme: .dark)
    let background = try #require(view.layer?.sublayers?.first as? CAShapeLayer)

    for status in [TerminalHorizontalTabTrailingStatus.attention, .dirty] {
      view.apply(status, palette: palette, isSelected: false, reduceMotion: true)
      view.layoutSubtreeIfNeeded()

      #expect(
        background.path?.boundingBoxOfPath
          == CGRect(x: 7.5, y: 7.5, width: 7, height: 7)
      )
    }
  }

  @Test
  func groupStatesSharePaintAndKeepTheirMaskAndSelectedBridge() throws {
    let view = TerminalHorizontalTabGroupView(
      frame: CGRect(x: 0, y: 0, width: 240, height: 38)
    )
    view.apply(
      HorizontalTabGroupChrome(
        color: .blue,
        isCollapsed: false,
        headerFrame: CGRect(x: 2, y: 4, width: 68, height: 30),
        firstChildFrame: CGRect(x: 74, y: 4, width: 72, height: 30),
        isFirstChildSelected: true
      ),
      palette: Palette(colorScheme: .dark),
      reduceMotion: true
    )
    view.layoutSubtreeIfNeeded()

    let layers = try #require(view.layer?.sublayers)
    let expanded = try #require(layers[0] as? CAShapeLayer)
    let collapsed = try #require(layers[1] as? CAShapeLayer)
    let bridge = try #require(layers[3] as? CAShapeLayer)
    let mask = try #require(expanded.mask as? CAShapeLayer)

    #expect(expanded.fillColor == collapsed.fillColor)
    #expect(expanded.strokeColor == collapsed.strokeColor)
    #expect(mask.path?.boundingBoxOfPath == expanded.path?.boundingBoxOfPath)
    #expect(bridge.path != nil)
  }

  @Test
  func horizontalItemsExposeStableAccessibleStateAndActions() throws {
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let view = TerminalHorizontalTabItemView()
    view.onClose = {}
    view.apply(
      TerminalHorizontalTabItemPresentation(
        content: .tab(
          id: tabID,
          title: "Build",
          subtitle: nil,
          accessibilityTitle: "Build",
          agentStatus: .working,
          trailingStatus: .dirty
        ),
        isSelected: true,
        selectedTint: nil
      ),
      palette: Palette(colorScheme: .dark),
      reduceMotion: true
    )

    #expect(
      view.accessibilityIdentifier()
        == HorizontalTabAccessibilityID.tab(tabID)
    )
    #expect(view.accessibilityLabel() == "Build, Agent working, Unsaved changes")
    #expect((view.accessibilityValue() as? NSNumber)?.boolValue == true)
    #expect(view.accessibilityCustomActions()?.map(\.name) == ["Close Tab"])
    let closeButton = try #require(
      view.subviews.compactMap { $0 as? NSButton }
        .first { $0.accessibilityLabel() == "Close Tab" }
    )
    #expect(
      closeButton.accessibilityIdentifier()
        == HorizontalTabAccessibilityID.tabClose(tabID)
    )

    view.apply(
      TerminalHorizontalTabItemPresentation(
        content: .group(
          id: groupID,
          title: "Release",
          color: .purple,
          iconURL: nil,
          isCollapsed: true,
          hasUnread: true,
          tabCount: 3
        ),
        isSelected: false,
        selectedTint: .purple
      ),
      palette: Palette(colorScheme: .dark),
      reduceMotion: true
    )

    #expect(
      view.accessibilityIdentifier()
        == HorizontalTabAccessibilityID.group(groupID)
    )
    #expect(view.accessibilityLabel() == "Release, Purple group, 3 tabs, unread activity")
    #expect(view.accessibilityValue() as? String == "Collapsed")
    #expect(
      view.accessibilityCustomActions()?.map(\.name)
        == ["New Tab in Group", "Close Group"]
    )
  }

  private func pane(
    title: String,
    indicator: TerminalTabPanePresentation.Indicator? = nil,
    isFocused: Bool = false
  ) -> TerminalTabPanePresentation {
    TerminalTabPanePresentation(
      id: UUID(),
      title: title,
      indicator: indicator,
      isFocused: isFocused
    )
  }
}
