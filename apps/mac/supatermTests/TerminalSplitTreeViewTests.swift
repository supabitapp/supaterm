import GhosttyKit
import SupaTheme
import SupatermCLIShared
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSplitTreeViewTests {
  final class MockSurfaceView: NSView, Identifiable {
    let id = UUID()
  }

  private func agentPanelObscuresCursor(
    _ cursorRect: CGRect?,
    panelHeight: CGFloat? = 180,
    topPadding: CGFloat = 12
  ) -> Bool {
    TerminalSplitTreeView.LeafView.shouldTemporarilyCollapseAgentPanel(
      cursorRect: cursorRect,
      surfaceSize: CGSize(width: 800, height: 600),
      panelHeight: panelHeight,
      topPadding: topPadding
    )
  }

  @Test
  func progressBarUsesTerminalThemeColorForActiveProgress() {
    let themeColor = Color(red: 0.2, green: 0.4, blue: 0.6)
    let progressBar = GhosttySurfaceProgressBar(
      progressState: GHOSTTY_PROGRESS_STATE_SET,
      progressValue: 42,
      themeColor: themeColor
    )

    expectSameColor(progressBar.progressColor, themeColor)
  }

  @Test
  func progressBarKeepsSemanticColorsForErrorAndPause() {
    let themeColor = Color.purple
    let errorProgressBar = GhosttySurfaceProgressBar(
      progressState: GHOSTTY_PROGRESS_STATE_ERROR,
      progressValue: nil,
      themeColor: themeColor
    )
    let pausedProgressBar = GhosttySurfaceProgressBar(
      progressState: GHOSTTY_PROGRESS_STATE_PAUSE,
      progressValue: nil,
      themeColor: themeColor
    )

    expectSameColor(errorProgressBar.progressColor, .red)
    expectSameColor(pausedProgressBar.progressColor, .orange)
  }

  @Test
  @MainActor
  func splitContainerOwnsItsBackgroundBelowHostedTerminals() {
    let initialColor = NSColor(deviceWhite: 0.1, alpha: 1)
    let updatedColor = NSColor(deviceWhite: 0.2, alpha: 1)
    let container = TerminalSplitAXContainerView(backgroundColor: initialColor)
    let rootView = TerminalSplitTreeView(
      agentPanelPresentations: [:],
      dimmingColor: .clear,
      dimmingOpacity: 0,
      focusedSurfaceID: nil,
      hiddenAgentPanelSurfaceIDs: [],
      terminalAccentColor: .clear,
      palette: Palette(colorScheme: .dark),
      agentPanelForksDown: false,
      agentPanelShortcutHint: nil,
      showsGlowingPaneRing: false,
      splitDividerColor: .clear,
      tree: SplitTree(),
      unreadSurfaceIDs: [],
      action: { _ in }
    )

    container.update(
      backgroundColor: updatedColor,
      rootView: rootView,
      visibleNode: nil,
      action: { _ in },
      panes: []
    )

    #expect(container.backgroundColor == updatedColor)
    #expect(container.subviews.count == 2)
  }

  @Test
  func paneDragSourceCoversTheTopOfItsPane() {
    #expect(
      TerminalPaneDragSourceLayout.frame(
        for: CGRect(x: 20, y: 30, width: 300, height: 200)
      ) == CGRect(x: 20, y: 220, width: 300, height: 10)
    )
  }

  @Test
  func notificationPulsePatternMatchesThreeFixedSizePulses() {
    #expect(TerminalNotificationPulsePattern.initialOpacity == 1)
    #expect(TerminalNotificationPulsePattern.lowOpacity == 0.32)
    #expect(TerminalNotificationPulsePattern.totalDuration == 1)
    #expect(
      TerminalNotificationPulsePattern.targetOpacities == [
        0.32,
        1,
        0.32,
        1,
        0.32,
        1,
        0,
      ]
    )
    #expect(TerminalNotificationPulsePattern.stepDuration == 1.0 / 7.0)
    #expect(TerminalNotificationPulsePattern.segments.count == 7)
    #expect(
      TerminalNotificationPulsePattern.segments.map(\.targetOpacity) == TerminalNotificationPulsePattern.targetOpacities
    )
    #expect(TerminalNotificationPulsePattern.segments.map(\.duration) == Array(repeating: 1.0 / 7.0, count: 7))
    #expect(
      TerminalNotificationPulsePattern.segments.first
        == TerminalNotificationPulseSegment(delay: 0, duration: 1.0 / 7.0, targetOpacity: 0.32))
    #expect(
      TerminalNotificationPulsePattern.segments.last
        == TerminalNotificationPulseSegment(delay: 6.0 / 7.0, duration: 1.0 / 7.0, targetOpacity: 0))
  }

  @Test
  func notificationPulseTriggersOnlyWhenAttentionDismisses() {
    #expect(
      !TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(
        from: false,
        to: false,
        reduceMotion: false
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(
        from: false,
        to: true,
        reduceMotion: false
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(
        from: true,
        to: true,
        reduceMotion: false
      )
    )
    #expect(
      TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(
        from: true,
        to: false,
        reduceMotion: false
      )
    )
  }

  @Test
  func notificationPulseStopsWhenReduceMotionIsEnabled() {
    #expect(
      !TerminalSplitTreeView.LeafView.shouldTriggerNotificationPulse(
        from: true,
        to: false,
        reduceMotion: true
      )
    )
  }

  @Test
  func visibleAttentionRequiresUnreadAndEnabledGlowingPaneRing() {
    #expect(
      TerminalSplitTreeView.LeafView.hasVisibleAttention(
        isUnread: true,
        showsGlowingPaneRing: true
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.hasVisibleAttention(
        isUnread: false,
        showsGlowingPaneRing: true
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.hasVisibleAttention(
        isUnread: true,
        showsGlowingPaneRing: false
      )
    )
  }

  @Test
  func splitDimmingRequiresUnfocusedSplitPaneAndVisibleOpacity() {
    let focusedID = UUID()
    let otherID = UUID()

    #expect(
      TerminalSplitTreeView.LeafView.shouldDimSplit(
        isSplit: true,
        focusedSurfaceID: focusedID,
        surfaceID: otherID,
        dimmingOpacity: 0.3
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.shouldDimSplit(
        isSplit: true,
        focusedSurfaceID: focusedID,
        surfaceID: focusedID,
        dimmingOpacity: 0.3
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.shouldDimSplit(
        isSplit: false,
        focusedSurfaceID: focusedID,
        surfaceID: otherID,
        dimmingOpacity: 0.3
      )
    )
    #expect(
      !TerminalSplitTreeView.LeafView.shouldDimSplit(
        isSplit: true,
        focusedSurfaceID: focusedID,
        surfaceID: otherID,
        dimmingOpacity: 0
      )
    )
  }

  @Test
  func splitDimmingTreatsMissingFocusAsUnfocused() {
    #expect(
      TerminalSplitTreeView.LeafView.shouldDimSplit(
        isSplit: true,
        focusedSurfaceID: nil,
        surfaceID: UUID(),
        dimmingOpacity: 0.3
      )
    )
  }

  @Test
  func agentPanelShowsForPaneWithPresentationRoom() {
    let focusedID = UUID()
    let agentPaneID = UUID()
    let presentation = PaneAgentPanelPresentation(
      progressRows: [
        PaneAgentProgressRow(id: "1", title: "Run tests", status: .running)
      ]
    )

    #expect(
      TerminalSplitTreeView.LeafView.agentPanelOverlayState(
        presentation: presentation,
        focusedSurfaceID: focusedID,
        surfaceID: focusedID,
        size: CGSize(width: 420, height: 260),
        isCollapsed: false
      ) == .expandedPanel
    )
    #expect(
      TerminalSplitTreeView.LeafView.agentPanelOverlayState(
        presentation: presentation,
        focusedSurfaceID: focusedID,
        surfaceID: agentPaneID,
        size: CGSize(width: 420, height: 260),
        isCollapsed: false
      ) == .expandedPanel
    )
    #expect(
      TerminalSplitTreeView.LeafView.agentPanelOverlayState(
        presentation: presentation,
        focusedSurfaceID: focusedID,
        surfaceID: focusedID,
        size: CGSize(width: 420, height: 260),
        isCollapsed: true
      ) == .collapsedIcon
    )
    #expect(
      TerminalSplitTreeView.LeafView.agentPanelOverlayState(
        presentation: presentation,
        focusedSurfaceID: focusedID,
        surfaceID: focusedID,
        size: CGSize(width: 320, height: 260),
        isCollapsed: false
      ) == .hidden
    )
  }

  @Test
  func agentPanelShowsForSessionActionsOnly() {
    let surfaceID = UUID()
    let presentation = PaneAgentPanelPresentation(
      session: PaneAgentPanelSession.supported(agent: .codex, sessionID: "session-1")
    )

    #expect(
      TerminalSplitTreeView.LeafView.agentPanelOverlayState(
        presentation: presentation,
        focusedSurfaceID: surfaceID,
        surfaceID: surfaceID,
        size: CGSize(width: 420, height: 260),
        isCollapsed: false
      ) == .expandedPanel
    )
  }

  @Test
  func agentPanelMovesBelowSearchOverlayWhenSearchIsVisible() {
    #expect(TerminalSplitTreeView.LeafView.agentPanelTopPadding(searchIsVisible: false) == 12)
    #expect(
      TerminalSplitTreeView.LeafView.agentPanelTopPadding(searchIsVisible: true)
        == GhosttySurfaceSearchOverlay.topReservedHeight
    )
  }

  @Test
  func agentPanelMaxHeightLeavesTopAndBottomPadding() {
    #expect(
      TerminalSplitTreeView.LeafView.maxAgentPanelHeight(
        surfaceSize: CGSize(width: 800, height: 600),
        topPadding: 12
      ) == 576
    )
    #expect(
      TerminalSplitTreeView.LeafView.maxAgentPanelHeight(
        surfaceSize: CGSize(width: 800, height: 600),
        topPadding: GhosttySurfaceSearchOverlay.topReservedHeight
      ) == 600 - GhosttySurfaceSearchOverlay.topReservedHeight - 12
    )
  }

  @Test
  func collapsedAgentPanelKeepsOnlyToggleWidth() {
    #expect(TerminalSplitTreeView.LeafView.agentPanelOverlayWidth(isCollapsed: false) == 306)
    #expect(TerminalSplitTreeView.LeafView.agentPanelOverlayWidth(isCollapsed: true) == 30)
  }

  @Test
  func caretNearExpandedAgentPanelTemporarilyCollapsesIt() {
    #expect(agentPanelObscuresCursor(CGRect(x: 470, y: 400, width: 10, height: 20)))
  }

  @Test
  func agentPanelRemainsVisibleWhenCaretCannotObscureIt() {
    #expect(!agentPanelObscuresCursor(CGRect(x: 450, y: 400, width: 8, height: 20)))
    #expect(!agentPanelObscuresCursor(CGRect(x: 500, y: 370, width: 10, height: 8)))
    #expect(!agentPanelObscuresCursor(nil))
    #expect(!agentPanelObscuresCursor(CGRect(x: 470, y: 400, width: 10, height: 20), panelHeight: nil))
  }

  @Test
  func searchOffsetMovesAgentPanelCursorAvoidanceRegion() {
    let cursorRect = CGRect(x: 500, y: 570, width: 10, height: 10)

    #expect(agentPanelObscuresCursor(cursorRect))
    #expect(!agentPanelObscuresCursor(cursorRect, topPadding: GhosttySurfaceSearchOverlay.topReservedHeight))
  }

  @Test
  func agentPanelShortcutsDisplayCommandHints() {
    #expect(SupatermShortcuts.toggleAgentPanel.defaultBinding.display == "⌘I")
    #expect(SupatermShortcuts.openPullRequest.defaultBinding.display == "⌘⌥P")
    #expect(SupatermShortcuts.forkAgentSession.defaultBinding.display == "⌘⌥F")
    #expect(SupatermShortcuts.copyAgentSessionID.defaultBinding.display == "⌘⌥C")
  }

  @Test
  func agentPanelShortcutHintsOnlyShowInFocusedPane() {
    let focusedSurfaceID = UUID()
    let unfocusedSurfaceID = UUID()
    let hint = SupatermShortcuts.toggleAgentPanel.defaultBinding.display

    #expect(
      TerminalSplitTreeView.LeafView.visibleShortcutHint(
        hint,
        focusedSurfaceID: focusedSurfaceID,
        surfaceID: focusedSurfaceID
      ) == hint
    )
    #expect(
      TerminalSplitTreeView.LeafView.visibleShortcutHint(
        hint,
        focusedSurfaceID: focusedSurfaceID,
        surfaceID: unfocusedSurfaceID
      ) == nil
    )
  }

  @Test
  func agentPanelForkDirectionFollowsOptionState() {
    #expect(AgentPanelView.forkDirection(forksDown: false) == .right)
    #expect(AgentPanelView.forkDirection(forksDown: true) == .down)
  }

  @Test
  func agentPanelForkTitleFollowsOptionState() {
    #expect(AgentPanelView.forkTitle(forksDown: false) == "Fork session right")
    #expect(AgentPanelView.forkTitle(forksDown: true) == "Fork session below")
  }

  @Test
  func agentPanelForkHelpTextExplainsOptionState() {
    #expect(
      AgentPanelView.forkHelpText(forksDown: false)
        == "Fork session right. Hold Option to fork below."
    )
    #expect(
      AgentPanelView.forkHelpText(forksDown: true)
        == "Fork session below. Release Option to fork right."
    )
  }

  @Test
  func horizontalSplitDropsInnerLeadingAndTrailingEdges() {
    let outerEdges: TerminalSplitTreeView.OuterEdges = .all

    #expect(
      outerEdges.child(.left, in: .horizontal)
        == [.top, .bottom, .leading]
    )
    #expect(
      outerEdges.child(.right, in: .horizontal)
        == [.top, .bottom, .trailing]
    )
  }

  @Test
  func verticalSplitDropsInnerTopAndBottomEdges() {
    let outerEdges: TerminalSplitTreeView.OuterEdges = .all

    #expect(
      outerEdges.child(.left, in: .vertical)
        == [.top, .leading, .trailing]
    )
    #expect(
      outerEdges.child(.right, in: .vertical)
        == [.bottom, .leading, .trailing]
    )
  }

  @Test
  func cornerRadiiKeepTopEdgeSquare() {
    let radii = TerminalSplitTreeView.OuterEdges([.top, .bottom, .leading])
      .cornerRadii(cornerRadius: 16)

    #expect(radii.topLeading == 0)
    #expect(radii.bottomLeading == 16)
    #expect(radii.topTrailing == 0)
    #expect(radii.bottomTrailing == 0)
  }

  @Test
  func dropZoneUsesTopForTopEdge() {
    let zone = TerminalSplitDropZone.calculate(
      at: CGPoint(x: 60, y: 4),
      in: CGSize(width: 120, height: 120)
    )

    #expect(zone == .top)
  }

  @Test
  func dividerDescriptorsFollowSplitTreeOrder() {
    let views = (0..<3).map { _ in MockSurfaceView() }
    let tree = SplitTree(
      root: .split(
        SplitTree<MockSurfaceView>.Split(
          direction: .horizontal,
          ratio: 0.5,
          left: .leaf(view: views[0]),
          right: .split(
            SplitTree<MockSurfaceView>.Split(
              direction: .vertical,
              ratio: 0.25,
              left: .leaf(view: views[1]),
              right: .leaf(view: views[2])
            ))
        )),
      zoomed: nil
    )

    let descriptors = TerminalSplitAccessibility.dividerDescriptors(
      for: tree.root,
      in: CGRect(x: 0, y: 0, width: 200, height: 100)
    )

    #expect(descriptors.map(\.path) == [.root, TerminalSplitAXPath(components: [TerminalSplitAXPathComponent.right])])
    #expect(descriptors.map(\.accessibilityLabel) == ["Horizontal split divider", "Vertical split divider"])
    #expect(
      descriptors.map(\.accessibilityHelp) == [
        "Drag to resize the left and right panes",
        "Drag to resize the top and bottom panes",
      ])
    #expect(descriptors[0].frameInParentSpace == CGRect(x: 96.5, y: 0, width: 7, height: 100))
    #expect(descriptors[1].frameInParentSpace == CGRect(x: 100, y: 21.5, width: 100, height: 7))
  }

  @Test
  func dividerAdjustmentUsesTenPointStep() {
    let descriptor = TerminalSplitDividerAXDescriptor(
      path: .root,
      direction: .horizontal,
      ratio: 0.5,
      splitBounds: CGRect(x: 0, y: 0, width: 200, height: 100),
      frameInParentSpace: .zero
    )

    #expect(descriptor.adjustedRatio(incrementing: true) == 0.55)
    #expect(descriptor.adjustedRatio(incrementing: false) == 0.45)
  }

  @Test
  func dividerAdjustmentClampsToMinimumPaneSize() {
    let descriptor = TerminalSplitDividerAXDescriptor(
      path: .root,
      direction: .horizontal,
      ratio: 0.12,
      splitBounds: CGRect(x: 0, y: 0, width: 80, height: 100),
      frameInParentSpace: .zero
    )

    #expect(descriptor.adjustedRatio(incrementing: false) == 0.125)
    #expect(descriptor.adjustedRatio(incrementing: true) == 0.245)
  }
}

private func expectSameColor(
  _ actual: Color,
  _ expected: Color,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  let actual = actual.resolve(in: EnvironmentValues())
  let expected = expected.resolve(in: EnvironmentValues())
  #expect(
    abs(actual.red - expected.red) < 0.0001
      && abs(actual.green - expected.green) < 0.0001
      && abs(actual.blue - expected.blue) < 0.0001
      && abs(actual.opacity - expected.opacity) < 0.0001,
    sourceLocation: sourceLocation
  )
}
