import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateNotificationTests {
  @Test
  func directInteractionClearsAttentionWithoutDroppingLatestText() {
    let notifications = [
      makeNotification(
        attentionState: .unread,
        body: "Build finished",
        createdAt: 1,
        title: "Build"
      ),
      makeNotification(
        attentionState: .unread,
        body: "Deploy complete",
        createdAt: 2,
        title: "Deploy"
      ),
    ]

    let updatedNotifications = TerminalHostState.notificationsAfterDirectInteraction(
      notifications,
      activity: TerminalHostState.SurfaceActivity(isVisible: true, isFocused: true)
    )

    #expect(updatedNotifications.map(\.attentionState) == [nil, nil])
    #expect(
      TerminalHostState.notificationText(
        TerminalHostState.latestNotification(in: updatedNotifications)
      ) == "Deploy complete"
    )
  }

  @Test
  func latestNotificationUsesNewestTimestamp() {
    let older = makeNotification(
      attentionState: .unread,
      body: "older",
      createdAt: 1,
      title: "Older"
    )
    let newer = makeNotification(
      attentionState: nil,
      body: "newer",
      createdAt: 2,
      title: "Newer"
    )

    #expect(
      TerminalHostState.latestNotification(in: [older, newer]) == newer
    )
  }

  @Test
  func unreadNotificationRecordCountCountsOnlyUnreadNotifications() {
    let notifications = [
      makeNotification(attentionState: .unread, createdAt: 1, title: "One"),
      makeNotification(attentionState: .unread, createdAt: 2, title: "Two"),
      makeNotification(attentionState: .unread, createdAt: 3, title: "Three"),
      makeNotification(attentionState: nil, createdAt: 4, title: "Four"),
    ]

    #expect(
      TerminalHostState.unreadNotificationRecordCount(in: notifications) == 3
    )
  }

  @Test
  func surfaceAttentionStateReturnsUnreadWhenAnyUnreadExists() {
    let notifications = [
      makeNotification(attentionState: nil, createdAt: 1, title: "Hidden"),
      makeNotification(attentionState: .unread, createdAt: 2, title: "Unread"),
    ]

    #expect(
      TerminalHostState.surfaceAttentionState(in: notifications) == .unread
    )
  }

  @Test
  func notificationTextPrefersBodyThenFallsBackToTrimmedTitle() {
    let bodyFirst = makeNotification(
      attentionState: .unread,
      body: "  Build finished  ",
      createdAt: 1,
      title: "Deploy complete"
    )
    let titleFallback = makeNotification(
      attentionState: .unread,
      body: "   ",
      createdAt: 2,
      title: "  Deploy complete  "
    )
    let blank = makeNotification(
      attentionState: nil,
      body: " ",
      createdAt: 3,
      title: " "
    )

    #expect(TerminalHostState.notificationText(bodyFirst) == "Build finished")
    #expect(TerminalHostState.notificationText(titleFallback) == "Deploy complete")
    #expect(TerminalHostState.notificationText(blank) == nil)
  }

  @Test
  func sidebarNotificationPreviewTextDropsMarkdownSyntax() {
    let preview = TerminalHostState.sidebarNotificationPreviewText(
      """
      # Supaterm Notes

      ## Features
      - **Fast** tabbed terminal workflows
      - [Docs](https://supaterm.com/docs)
      - <https://supaterm.com/download>

      > `socketctl`

      | Area | Status | Owner |
      | --- | --- | --- |
      | Terminal | Done | khoi |

      ```swift
      print("hi")
      ```
      """
    )
    let expectedPreview =
      "Supaterm Notes Features Fast tabbed terminal workflows Docs socketctl "
      + "Area · Status · Owner Terminal · Done · khoi print(\"hi\")"

    #expect(
      preview == expectedPreview
    )
    #expect(!preview.contains("https://"))
  }

  @Test
  func sidebarNotificationPresentationBuildsCompactPreview() throws {
    let notification = makeNotification(
      attentionState: .unread,
      body: """
        ## Release

        - [Docs](https://example.com)
        - `sp`
        """,
      createdAt: 1,
      title: "Ignored"
    )

    let presentation = try #require(
      TerminalHostState.sidebarNotificationPresentation(notification)
    )

    #expect(
      presentation
        == TerminalHostState.SidebarNotificationPresentation(
          previewText: "Release Docs sp"
        )
    )
  }

  @Test
  func sidebarNotificationPresentationFallsBackToTitleText() throws {
    let notification = makeNotification(
      attentionState: .unread,
      body: "   ",
      createdAt: 1,
      title: "  [Ship notes](https://example.com)  "
    )

    let presentation = try #require(
      TerminalHostState.sidebarNotificationPresentation(notification)
    )

    #expect(
      presentation
        == TerminalHostState.SidebarNotificationPresentation(
          previewText: "Ship notes"
        )
    )
  }

  @Test
  func sidebarNotificationPresentationOmitsEmptyPreview() throws {
    let notification = makeNotification(
      attentionState: .unread,
      body: "https://example.com",
      createdAt: 1,
      title: "Ignored"
    )

    #expect(TerminalHostState.sidebarNotificationPresentation(notification) == nil)
  }

  @Test
  func desktopNotificationCallbackStoresUnreadAttentionAndResolvesTabTitleOnBlankTitle() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let expectedTitle = try #require(host.tabs.first(where: { $0.id == tabID })?.title)
    let surface = try #require(host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("   ", "Build finished")

    let event = try #require(await iterator.next())
    guard case .notificationReceived(let notification) = event else {
      Issue.record("Expected notificationReceived event.")
      return
    }

    #expect(notification.attentionState == .unread)
    #expect(notification.body == "Build finished")
    #expect(notification.desktopNotificationDisposition == .suppressFocused)
    #expect(notification.resolvedTitle == expectedTitle)
    #expect(notification.sourceSurfaceID == surface.id)
    #expect(notification.subtitle.isEmpty)
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Build finished")
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))
  }

  @Test
  func desktopNotificationCallbackRequestsDesktopDeliveryWhenWindowIsInactive() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Deploy complete", "")

    let event = try #require(await iterator.next())
    guard case .notificationReceived(let notification) = event else {
      Issue.record("Expected notificationReceived event.")
      return
    }

    #expect(notification.attentionState == .unread)
    #expect(notification.body.isEmpty)
    #expect(notification.desktopNotificationDisposition == .deliver)
    #expect(notification.resolvedTitle == "Deploy complete")
    #expect(notification.sourceSurfaceID == surface.id)
    #expect(notification.subtitle.isEmpty)
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
  }

  @Test
  func desktopNotificationCallbackKeepsDistinctNotificationAfterStructuredCompletion() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notifyStructuredAgent(
      TerminalNotifyRequest(
        body: "Done.",
        target: .pane(surface.id),
        title: "Codex",
        allowDesktopNotificationWhenAgentActive: true
      ),
      semantic: .completion
    )

    surface.bridge.onDesktopNotification?("Build", "Build finished")

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Build finished")
  }

  @Test
  func structuredCompletionReplacesRecentTerminalCompletionFallback() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    surface.bridge.onDesktopNotification?("Codex", "Agent turn complete")

    _ = try host.notifyStructuredAgent(
      TerminalNotifyRequest(
        body: "Done.",
        target: .pane(surface.id),
        title: "Codex",
        allowDesktopNotificationWhenAgentActive: true
      ),
      semantic: .completion
    )

    #expect(host.notificationRecordCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Done.")
  }

  @Test
  func notifySuppressesDesktopDeliveryWhenAgentIsRunning() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let expectedTitle = try #require(host.tabs.first(where: { $0.id == tabID })?.title)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setTestAgentActivity(.claude(.running), for: surface.id))

    let result = try host.notify(
      TerminalNotifyRequest(
        body: "Build finished",
        target: .pane(surface.id),
        title: nil
      )
    )

    #expect(result.attentionState == .unread)
    #expect(result.desktopNotificationDisposition == .suppressAgent)
    #expect(result.resolvedTitle == expectedTitle)
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Build finished")
  }

  @Test
  func agentActivityStoresNormalizedDetail() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(
      host.setTestAgentActivity(
        .codex(.running, detail: "  Bash · git status --short  "),
        for: surface.id
      )
    )

    #expect(
      host.agentActivity(for: tabID)
        == .codex(.running, detail: "Bash · git status --short")
    )
    #expect(host.showsAgentActivityDetail(for: tabID))
  }

  @Test
  func codexHoverMarkdownShowsOldestMessageFirstWithLineBreak() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(
      host.startTestAgentSession(
        agent: .codex,
        for: surface.id,
        sessionID: "session-1",
        processID: nil
      )
    )

    #expect(host.setTestAgentHoverMessages(["First message"], replacing: false, for: surface.id))
    #expect(host.setTestAgentHoverMessages(["Second message"], replacing: false, for: surface.id))

    #expect(
      host.codexHoverMarkdown(for: tabID) == """
        First message

        Second message
        """
    )
  }

  @Test
  func replacingCodexHoverMarkdownDropsEarlierMessages() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(
      host.startTestAgentSession(
        agent: .codex,
        for: surface.id,
        sessionID: "session-1",
        processID: nil
      )
    )

    #expect(host.setTestAgentHoverMessages(["First message", "Second message"], replacing: false, for: surface.id))
    #expect(host.setTestAgentHoverMessages(["Final answer"], replacing: true, for: surface.id))

    #expect(host.codexHoverMarkdown(for: tabID) == "Final answer")
  }

  @Test
  func agentActivityDetailHidesWhenFocusMovesToDifferentPaneInSameTab() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(
      host.setTestAgentActivity(
        .codex(.running, detail: "Bash · git status --short"),
        for: firstSurface.id
      )
    )
    #expect(host.showsAgentActivityDetail(for: tabID))

    _ = try host.focusPane(TerminalPaneTarget(paneID: secondPane.paneID))

    #expect(!host.showsAgentActivityDetail(for: tabID))

    _ = try host.focusPane(TerminalPaneTarget(paneID: firstSurface.id))

    #expect(host.showsAgentActivityDetail(for: tabID))
  }

  @Test
  func tabBadgeUsesHighestPriorityPaneWhileDetailAndHoverStayFocused() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(
      host.setTestAgentActivity(
        .codex(.running, detail: "Focused detail"),
        for: firstSurface.id
      )
    )
    #expect(host.setTestAgentHoverMessages(["Focused hover"], replacing: false, for: firstSurface.id))
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondPane.paneID))
    #expect(host.setTestAgentHoverMessages(["Background hover"], replacing: false, for: secondPane.paneID))

    #expect(host.agentActivity(for: tabID) == .claude(.needsInput))
    #expect(host.showsAgentActivityDetail(for: tabID))
    #expect(host.codexHoverMarkdown(for: tabID) == "Focused hover")
    #expect(!host.tabAgentPresentation(for: tabID).badgeActivityIsFocused)
  }

  @Test
  func tabAgentPresentationMarksFocusedBadgeActivity() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: surface.id))

    let presentation = host.tabAgentPresentation(for: tabID)
    #expect(presentation.badgeActivity == .codex(.needsInput))
    #expect(presentation.badgeActivityIsFocused)
  }

  @Test
  func tabAgentPresentationStacksMultipleAgentBadges() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(host.setTestAgentActivity(.claude(.running), for: firstSurface.id))
    #expect(host.setTestAgentActivity(.codex(.running), for: secondPane.paneID))

    #expect(
      host.tabAgentPresentation(for: tabID).badgeActivities == [.claude(.running), .codex(.running)]
    )
  }

  @Test
  func tabAgentPresentationDoesNotMarkBackgroundTabBadgeActivityFocused() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let firstTabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: firstSurface.id))

    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

    let presentation = host.tabAgentPresentation(for: firstTabID)
    #expect(presentation.badgeActivity == .codex(.needsInput))
    #expect(!presentation.badgeActivityIsFocused)
  }

  @Test
  func codexHoverMarkdownFollowsFocusedPaneOnly() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(host.setTestAgentActivity(.codex(.running), for: firstSurface.id))
    #expect(host.setTestAgentHoverMessages(["Focused hover"], replacing: false, for: firstSurface.id))
    #expect(host.setTestAgentActivity(.codex(.idle), for: firstSurface.id))
    #expect(host.setTestAgentActivity(.codex(.running), for: secondPane.paneID))
    #expect(host.setTestAgentHoverMessages(["Background hover"], replacing: false, for: secondPane.paneID))
    #expect(host.setTestAgentActivity(.codex(.idle), for: secondPane.paneID))
    #expect(host.codexHoverMarkdown(for: tabID) == "Focused hover")

    _ = try host.focusPane(TerminalPaneTarget(paneID: secondPane.paneID))

    #expect(host.codexHoverMarkdown(for: tabID) == "Background hover")
  }

  @Test
  func closingBadgeOwningPaneFallsBackToRemainingPaneActivity() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(host.setTestAgentActivity(.codex(.running, detail: "Focused detail"), for: firstSurface.id))
    #expect(host.setTestAgentHoverMessages(["Focused hover"], replacing: false, for: firstSurface.id))
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondPane.paneID))
    #expect(host.agentActivity(for: tabID) == .claude(.needsInput))

    host.performCloseSurface(secondPane.paneID)

    #expect(host.agentActivity(for: tabID) == .codex(.running, detail: "Focused detail"))
    #expect(host.showsAgentActivityDetail(for: tabID))
    #expect(host.codexHoverMarkdown(for: tabID) == "Focused hover")
  }

  @Test
  func commandFinishedClearsAgentActivityAndHoverMarkdown() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setTestAgentActivity(.claude(.running, detail: "Thinking"), for: surface.id))
    #expect(host.setTestAgentHoverMessages(["Thinking"], replacing: true, for: surface.id))

    surface.bridge.onCommandFinished?()

    #expect(host.agentActivity(for: tabID) == nil)
    #expect(host.codexHoverMarkdown(for: tabID) == nil)
  }

  @Test
  func notifyAggregatesMultipleNotificationsOnSameSurface() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Build finished",
        target: .pane(surface.id),
        title: "Build"
      )
    )
    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Deploy complete",
        target: .pane(surface.id),
        title: "Deploy"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))
  }

  @Test
  func notifyCountsUnreadAttentionPerSurface() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondSurface = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Build finished",
        target: .pane(firstSurface.id),
        title: "Build"
      )
    )
    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Deploy complete",
        target: .pane(secondSurface.paneID),
        title: "Deploy"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 2)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([firstSurface.id, secondSurface.paneID]))
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
  }

  @Test
  func hasUnreadSidebarNotificationsTracksVisibleTabAttention() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)

    #expect(!host.hasUnreadSidebarNotifications)

    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let surface = try #require(host.selectedSurfaceView)

    #expect(!host.hasUnreadSidebarNotifications)

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Input requested",
        target: .pane(surface.id),
        title: "Task"
      )
    )

    #expect(host.hasUnreadSidebarNotifications)

    host.handleDirectInteraction(on: surface.id)

    #expect(!host.hasUnreadSidebarNotifications)
  }

  @Test
  func selectingTabPrefersUnreadPaneFromBackgroundSplit() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let firstTabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondSurface = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Claude needs your attention",
        target: .pane(secondSurface.paneID),
        title: "Claude Code"
      )
    )

    #expect(host.selectedSurfaceView?.id == firstSurface.id)
    #expect(host.unreadNotifiedSurfaceIDs(in: firstTabID) == Set([secondSurface.paneID]))

    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

    let secondTabID = try #require(host.selectedTabID)
    #expect(secondTabID != firstTabID)

    host.handleCommand(.selectTab(firstTabID))

    #expect(host.selectedTabID == firstTabID)
    #expect(host.selectedSurfaceView?.id == secondSurface.paneID)
    #expect(host.unreadNotificationCount(for: firstTabID) == 0)
    #expect(host.unreadNotifiedSurfaceIDs(in: firstTabID).isEmpty)
    #expect(host.latestNotificationText(for: firstTabID) == nil)
  }

  @Test
  func directKeyboardInteractionClearsSidebarNotificationText() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Claude needs your attention",
        target: .pane(surface.id),
        title: "Claude Code"
      )
    )

    #expect(host.latestNotificationText(for: tabID) == "Claude needs your attention")

    host.handleDirectInteraction(on: surface.id)

    #expect(host.latestNotificationText(for: tabID) == nil)
    #expect(host.unreadNotificationCount(for: tabID) == 0)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID).isEmpty)
  }

  @Test
  func directMouseInteractionClearsUnreadAttentionOnFocusedPane() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Claude needs your attention",
        target: .pane(surface.id),
        title: "Claude Code"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))

    host.windowActivity = .inactive

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Build finished",
        target: .pane(surface.id),
        title: "Build"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))

    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.handleDirectInteraction(on: surface.id)

    #expect(host.latestNotificationText(for: tabID) == nil)
    #expect(host.unreadNotificationCount(for: tabID) == 0)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID).isEmpty)
  }

  @Test
  func closingPaneClearsAllPerSurfaceState() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let surface = try #require(host.selectedSurfaceView)
    host.notificationStore.append(
      makeNotification(attentionState: .unread, createdAt: 1, title: "Build"),
      for: surface.id
    )
    host.paneAgentMetadataBySurfaceID[surface.id] = TerminalHostState.PaneAgentMetadata()
    host.notificationStore.setRecentStructured(
      TerminalHostState.RecentStructuredNotification(
        recordedAt: Date(),
        semantic: .completion,
        text: "Done"
      ),
      for: surface.id
    )
    host.setTestAgentActivity(.claude(.running), for: surface.id)

    host.performCloseSurface(surface.id)

    #expect(host.notificationStore.notifications(for: surface.id) == nil)
    #expect(host.paneAgentMetadataBySurfaceID[surface.id] == nil)
    #expect(host.notificationStore.recentStructured(for: surface.id) == nil)
    #expect(host.agentStateStore.snapshots(for: surface.id).isEmpty)
    #expect(host.surfaces[surface.id] == nil)
  }

  private func makeNotification(
    attentionState: SupatermNotificationAttentionState?,
    body: String = "",
    createdAt: TimeInterval,
    title: String
  ) -> TerminalHostState.PaneNotification {
    TerminalHostState.PaneNotification(
      attentionState: attentionState,
      body: body,
      createdAt: Date(timeIntervalSince1970: createdAt),
      title: title
    )
  }
}

extension TerminalHostState {
  @discardableResult
  fileprivate func setTestAgentActivity(_ activity: AgentActivity, for surfaceID: UUID) -> Bool {
    applyTestAgentActivity(
      activity,
      for: surfaceID,
      sessionID: "test-\(activity.kind.rawValue)-\(surfaceID.uuidString)",
      processID: nil
    )
  }
}
