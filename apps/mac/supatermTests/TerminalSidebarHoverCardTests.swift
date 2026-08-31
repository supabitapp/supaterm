import AppKit
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarHoverCardTests {
  @Test
  func pullRequestModelPreservesURL() throws {
    let url = try #require(URL(string: "https://github.com/supabitapp/supaterm/pull/128"))
    let status = PaneAgentPullRequestStatus(
      kind: .open,
      title: "#128",
      url: url,
      addedLineCount: nil,
      removedLineCount: nil,
      checks: nil
    )

    let pullRequest = try #require(TerminalTabAgentWorkspace.PullRequest(status))

    #expect(pullRequest.url == url)
  }

  @Test @MainActor
  func pullRequestActionOpensURL() throws {
    let url = try #require(URL(string: "https://github.com/supabitapp/supaterm/pull/128"))
    let pullRequest = TerminalTabAgentWorkspace.PullRequest(
      kind: .open,
      title: "#128",
      url: url
    )
    var openedURLs: [URL] = []
    var copiedValues: [String] = []

    TerminalSidebarHoverCardRowAction.pullRequest(pullRequest).perform(
      clipboardClient: ClipboardClient { copiedValues.append($0) },
      externalNavigationClient: ExternalNavigationClient { url in
        openedURLs.append(url)
        return true
      }
    )

    #expect(openedURLs == [url])
    #expect(copiedValues.isEmpty)
  }

  @Test @MainActor
  func pullRequestActionCopiesTitleWithoutURL() {
    let pullRequest = TerminalTabAgentWorkspace.PullRequest(
      kind: .open,
      title: "#128",
      url: nil
    )
    var copiedValues: [String] = []
    var openedURLs: [URL] = []

    TerminalSidebarHoverCardRowAction.pullRequest(pullRequest).perform(
      clipboardClient: ClipboardClient { copiedValues.append($0) },
      externalNavigationClient: ExternalNavigationClient {
        openedURLs.append($0)
        return true
      }
    )

    #expect(copiedValues == ["#128"])
    #expect(openedURLs.isEmpty)
  }

  @Test @MainActor
  func shortResponseUsesItsContentHeight() {
    let content = TerminalSidebarHoverCardContent(
      tabTitle: "Ready",
      workspace: nil,
      response: TerminalHostState.TabAgentResponse(
        agent: AgentDetectionAgentIdentity(id: "agent", displayName: "Agent"),
        text: "Hello, khoi."
      )
    )
    let controller = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: content)
    )

    let size = controller.sizeThatFits(in: CGSize(width: 320, height: 800))

    #expect(size.height < 180)
  }

  @Test @MainActor
  func metadataCardDoesNotRequireAnAgentResponse() {
    let content = TerminalSidebarHoverCardContent(
      tabTitle: "Implement agent tab hover details",
      workspace: TerminalTabAgentWorkspace(
        workingDirectoryPath: "/Users/khoi/code/supaterm",
        branch: TerminalTabAgentWorkspace.Branch(
          repositoryRootPath: "/Users/khoi/code/supaterm",
          name: "main",
          pullRequest: nil
        )
      ),
      response: nil
    )
    let controller = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: content)
    )

    let size = controller.sizeThatFits(in: CGSize(width: 320, height: 800))

    #expect(size.height > 60)
    #expect(size.height < 180)
  }

  @Test @MainActor
  func metadataCardAddsPullRequestRowWhenAvailable() {
    let withoutPullRequest = TerminalSidebarHoverCardContent(
      tabTitle: "Agent tab",
      workspace: TerminalTabAgentWorkspace(
        workingDirectoryPath: "/Users/khoi/code/supaterm",
        branch: TerminalTabAgentWorkspace.Branch(
          repositoryRootPath: "/Users/khoi/code/supaterm",
          name: "feature/sidebar-hover-card",
          pullRequest: nil
        )
      ),
      response: nil
    )
    let withPullRequest = TerminalSidebarHoverCardContent(
      tabTitle: "Agent tab",
      workspace: TerminalTabAgentWorkspace(
        workingDirectoryPath: "/Users/khoi/code/supaterm",
        branch: TerminalTabAgentWorkspace.Branch(
          repositoryRootPath: "/Users/khoi/code/supaterm",
          name: "feature/sidebar-hover-card",
          pullRequest: TerminalTabAgentWorkspace.PullRequest(
            kind: .open,
            title: "#128",
            url: URL(string: "https://github.com/supabitapp/supaterm/pull/128")
          )
        )
      ),
      response: nil
    )
    let withoutPullRequestHeight = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: withoutPullRequest)
    ).sizeThatFits(in: CGSize(width: 320, height: 800)).height
    let withPullRequestHeight = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: withPullRequest)
    ).sizeThatFits(in: CGSize(width: 320, height: 800)).height

    #expect(withPullRequestHeight > withoutPullRequestHeight)
  }

  @Test @MainActor
  func fullTitleExpandsCardHeight() {
    let short = TerminalSidebarHoverCardContent(
      tabTitle: "Short title",
      workspace: nil,
      response: nil
    )
    let long = TerminalSidebarHoverCardContent(
      tabTitle: String(repeating: "A complete agent task title ", count: 12),
      workspace: nil,
      response: nil
    )
    let shortController = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: short)
    )
    let longController = NSHostingController(
      rootView: TerminalSidebarHoverCardView(content: long)
    )

    let shortHeight = shortController.sizeThatFits(in: CGSize(width: 320, height: 800)).height
    let longHeight = longController.sizeThatFits(in: CGSize(width: 320, height: 800)).height

    #expect(longHeight > shortHeight)
  }

  @Test @MainActor
  func longResponseUsesMaximumResponseHeight() {
    let response = AttributedString(
      String(repeating: "A long response line that wraps inside the hover card.\n", count: 100)
    )

    #expect(
      TerminalSidebarHoverCardMetrics.responseHeight(for: response)
        == TerminalSidebarHoverCardMetrics.maximumResponseHeight
    )
  }

  @Test
  func placesCardBesideAndCenteredOnSource() {
    let frame = TerminalSidebarHoverCardGeometry.frame(
      sourceFrame: CGRect(x: 100, y: 200, width: 180, height: 40),
      cardSize: CGSize(width: 320, height: 180),
      visibleFrame: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )

    #expect(frame.origin.x == 284)
    #expect(frame.midY == 220)
  }

  @Test
  func clampsCardToVisibleScreenInsets() {
    let frame = TerminalSidebarHoverCardGeometry.frame(
      sourceFrame: CGRect(x: 900, y: 760, width: 180, height: 40),
      cardSize: CGSize(width: 320, height: 180),
      visibleFrame: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )

    #expect(frame.maxX == 1_192)
    #expect(frame.maxY == 792)
  }

  @Test
  func corridorConnectsSourceAndCardWithoutCoveringOutsidePoints() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 100, y: 200, width: 180, height: 40),
      cardFrame: CGRect(x: 284, y: 130, width: 320, height: 180)
    )

    #expect(corridor.contains(CGPoint(x: 282, y: 220)))
    #expect(corridor.contains(CGPoint(x: 400, y: 300)))
    #expect(!corridor.contains(CGPoint(x: 50, y: 100)))
    #expect(!corridor.contains(CGPoint(x: 400, y: 400)))
  }

  @Test
  func corridorUsesExactSourceAndTwoPointCardExpansion() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 100, y: 200, width: 180, height: 40),
      cardFrame: CGRect(x: 284, y: 130, width: 320, height: 180)
    )

    #expect(corridor.contains(CGPoint(x: 100, y: 220)))
    #expect(!corridor.contains(CGPoint(x: 99.9, y: 220)))
    #expect(corridor.contains(CGPoint(x: 606, y: 220)))
    #expect(!corridor.contains(CGPoint(x: 606.1, y: 220)))
  }

  @Test
  func corridorIncludesNumericallyCollinearSlopedEdge() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 0, y: 0, width: 100, height: 40),
      cardFrame: CGRect(x: 104, y: 100, width: 100, height: 40)
    )

    #expect(corridor.contains(CGPoint(x: 50.9999999999, y: 91)))
  }

  @Test
  func hoverHitTestingRejectsPointOutsideVisibleViewport() {
    let visibleRect = CGRect(x: 0, y: 200, width: 240, height: 300)

    #expect(
      TerminalSidebarHoverCardGeometry.isPointVisible(
        CGPoint(x: 120, y: 250),
        visibleRect: visibleRect
      )
    )
    #expect(
      !TerminalSidebarHoverCardGeometry.isPointVisible(
        CGPoint(x: 120, y: 100),
        visibleRect: visibleRect
      )
    )
  }

  @Test
  func directionTrackerKeepsHullWhenProjectedRayHitsCard() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 0, y: 0, width: 100, height: 40),
      cardFrame: CGRect(x: 104, y: -50, width: 100, height: 140)
    )
    var tracker = TerminalSidebarHoverDirectionTracker()

    let first = tracker.permitsHull(at: CGPoint(x: 101, y: 20), corridor: corridor)
    let second = tracker.permitsHull(at: CGPoint(x: 109, y: 20), corridor: corridor)
    let third = tracker.permitsHull(at: CGPoint(x: 109, y: 30), corridor: corridor)
    #expect(first)
    #expect(second)
    #expect(third)
  }

  @Test
  func directionTrackerDisablesHullAfterProjectedRayMissesCard() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 0, y: 0, width: 100, height: 40),
      cardFrame: CGRect(x: 104, y: -50, width: 100, height: 140)
    )
    var tracker = TerminalSidebarHoverDirectionTracker()

    let first = tracker.permitsHull(at: CGPoint(x: 101, y: 45), corridor: corridor)
    let second = tracker.permitsHull(at: CGPoint(x: 101, y: 53), corridor: corridor)
    let third = tracker.permitsHull(at: CGPoint(x: 110, y: 40), corridor: corridor)
    #expect(first)
    #expect(!second)
    #expect(!third)
    tracker.reset()
    let reset = tracker.permitsHull(at: CGPoint(x: 101, y: 45), corridor: corridor)
    #expect(reset)
  }

  @Test
  func directionTrackerResetsInsideSource() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 0, y: 0, width: 100, height: 40),
      cardFrame: CGRect(x: 104, y: -50, width: 100, height: 140)
    )
    var tracker = TerminalSidebarHoverDirectionTracker()

    let first = tracker.permitsHull(at: CGPoint(x: 101, y: 45), corridor: corridor)
    let second = tracker.permitsHull(at: CGPoint(x: 101, y: 53), corridor: corridor)
    let source = tracker.permitsHull(at: CGPoint(x: 90, y: 20), corridor: corridor)
    let newStart = tracker.permitsHull(at: CGPoint(x: 101, y: 20), corridor: corridor)
    let belowThreshold = tracker.permitsHull(at: CGPoint(x: 108.9, y: 20), corridor: corridor)
    #expect(first)
    #expect(!second)
    #expect(source)
    #expect(newStart)
    #expect(belowThreshold)
  }

  @Test
  func directionTrackerResetsOnSourceMaximumEdge() {
    let corridor = TerminalSidebarHoverCorridor(
      sourceFrame: CGRect(x: 0, y: 0, width: 100, height: 40),
      cardFrame: CGRect(x: 104, y: -50, width: 100, height: 140)
    )
    var tracker = TerminalSidebarHoverDirectionTracker()

    let first = tracker.permitsHull(at: CGPoint(x: 101, y: 45), corridor: corridor)
    let decidedAway = tracker.permitsHull(at: CGPoint(x: 101, y: 53), corridor: corridor)
    let maximumEdge = tracker.permitsHull(at: CGPoint(x: 100, y: 40), corridor: corridor)
    let newStart = tracker.permitsHull(at: CGPoint(x: 101, y: 20), corridor: corridor)

    #expect(first)
    #expect(!decidedAway)
    #expect(maximumEdge)
    #expect(newStart)
  }

  @Test
  func hoverTimingsMatchInteractionContract() {
    #expect(TerminalSidebarHoverTiming.stopped == .milliseconds(80))
    #expect(TerminalSidebarHoverTiming.coldPresentation == .milliseconds(250))
    #expect(TerminalSidebarHoverTiming.dismiss == .milliseconds(100))
  }

  @Test
  func coldHoverStartsOnlyAfterPointerStops() {
    let tabID = TerminalTabID()

    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: .idle,
        eligibleTabID: tabID,
        insideSafeHull: false
      ) == .none
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: .idle,
        eligibleTabID: tabID,
        insideSafeHull: false,
        canReuseCard: false
      ) == .startCold(tabID)
    )
  }

  @Test
  func pendingTargetDoesNotRestartUntilItChanges() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let phase = TerminalSidebarHoverCardPhase.pending(first, 1)

    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: first,
        insideSafeHull: false
      ) == .none
    )
    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: second,
        insideSafeHull: false
      ) == .replacePending(second)
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: .pending(second, 2),
        eligibleTabID: second,
        insideSafeHull: false,
        canReuseCard: false
      ) == .present(second)
    )
  }

  @Test
  func presentedCardRetargetsOutsideHullAndWaitsInsideHull() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let phase = TerminalSidebarHoverCardPhase.presented(first)

    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: second,
        insideSafeHull: false
      ) == .update(second)
    )
    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: second,
        insideSafeHull: true
      ) == .cancelDismiss
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: phase,
        eligibleTabID: second,
        insideSafeHull: true,
        canReuseCard: false
      ) == .delayUpdate(second)
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: phase,
        eligibleTabID: second,
        insideSafeHull: false,
        canReuseCard: false
      ) == .update(second)
    )
  }

  @Test
  func visibleCardWinsOverUnderlyingRowHit() {
    let underlyingTabID = TerminalTabID()
    let point = CGPoint(x: 120, y: 220)

    #expect(
      TerminalSidebarHoverInteraction.eligibleTabID(
        pointedTabID: underlyingTabID,
        screenPoint: point,
        cardFrame: CGRect(x: 100, y: 200, width: 320, height: 180)
      ) == nil
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: .presented(TerminalTabID()),
        eligibleTabID: nil,
        insideSafeHull: true,
        canReuseCard: false
      ) == .cancelDismiss
    )
    #expect(
      TerminalSidebarHoverInteraction.eligibleTabID(
        pointedTabID: underlyingTabID,
        screenPoint: CGPoint(x: 420, y: 380),
        cardFrame: CGRect(x: 100, y: 200, width: 320, height: 180)
      ) == nil
    )
  }

  @Test
  func idleStopReusesVisibleCardWindow() {
    let tabID = TerminalTabID()

    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: .idle,
        eligibleTabID: tabID,
        insideSafeHull: false,
        canReuseCard: true
      ) == .reuse(tabID)
    )
  }

  @Test
  func outsideMovementRearmsDismissAndOutsideStopDismisses() {
    let phase = TerminalSidebarHoverCardPhase.presented(TerminalTabID())

    #expect(
      TerminalSidebarHoverInteraction.moved(
        phase: phase,
        eligibleTabID: nil,
        insideSafeHull: false
      ) == .rearmDismiss
    )
    #expect(
      TerminalSidebarHoverInteraction.stopped(
        phase: phase,
        eligibleTabID: nil,
        insideSafeHull: false,
        canReuseCard: false
      ) == .dismiss
    )
  }

  @Test
  func pendingMouseDownSuppressesPointedRowAndDismisses() {
    let pendingTabID = TerminalTabID()
    let pointedTabID = TerminalTabID()

    #expect(
      TerminalSidebarHoverInputInteraction.mouseDown(
        phase: .pending(pendingTabID, 1),
        pointedTabID: pointedTabID,
        isInsideCard: true
      ) == .dismiss(suppressedTabID: pointedTabID)
    )
  }

  @Test
  func presentedCardAcceptsMouseDownInsideCard() {
    #expect(
      TerminalSidebarHoverInputInteraction.mouseDown(
        phase: .presented(TerminalTabID()),
        pointedTabID: nil,
        isInsideCard: true
      ) == .keep
    )
  }

  @Test @MainActor
  func cancellingPendingHoverRemovesEventMonitor() async {
    let tabID = TerminalTabID()
    var pointedTabID: TerminalTabID? = tabID
    let controller = TerminalSidebarHoverCardController(
      tabAtPoint: { _ in pointedTabID },
      sourceForTab: { _ in nil },
      content: { _ in
        TerminalSidebarHoverCardContent(
          tabTitle: "Ready",
          workspace: nil,
          response: TerminalHostState.TabAgentResponse(
            agent: AgentDetectionAgentIdentity(id: "agent", displayName: "Agent"),
            text: "Done."
          )
        )
      },
      allowsPresentation: { true },
      reduceMotion: { true }
    )

    controller.pointerMoved()
    #expect(await waitUntil { controller.phase.tabID == tabID })
    #expect(controller.isMonitoringEvents)

    pointedTabID = nil
    controller.pointerExited()

    #expect(controller.phase == .idle)
    #expect(!controller.isMonitoringEvents)
  }
}
