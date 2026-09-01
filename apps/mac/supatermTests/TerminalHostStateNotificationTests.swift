import AppKit
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
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
  func viewingAgentCompletionsKeepsOtherAttentionUnread() {
    let notifications = [
      makeNotification(
        attentionState: .unread,
        createdAt: 1,
        title: "Done",
        origin: .structuredAgent(.completion)
      ),
      makeNotification(
        attentionState: .unread,
        createdAt: 2,
        title: "Input",
        origin: .structuredAgent(.attention)
      ),
      makeNotification(
        attentionState: .unread,
        createdAt: 3,
        title: "Build",
        origin: .terminalDesktop
      ),
    ]

    let updatedNotifications = TerminalHostState.notificationsAfterViewingAgentCompletions(
      notifications
    )

    #expect(updatedNotifications.map(\.attentionState) == [nil, .unread, .unread])
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
  func desktopNotificationCallbackStoresUnreadAttentionAndResolvesTabTitleOnBlankTitle() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let expectedTitle = try #require(host.tabs.first(where: { $0.id == tabID })?.title)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }
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

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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
  func zoomHiddenStructuredCompletionStaysUnread() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let visibleSurface = try #require(host.selectedSurfaceView)
    let hiddenPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: false,
        target: .pane(visibleSurface.id)
      )
    )
    #expect(host.performSplitAction(.toggleSplitZoom, for: visibleSurface.id))

    _ = try host.notifyStructuredAgent(
      TerminalNotifyRequest(
        body: "Done.",
        target: .pane(hiddenPane.paneID),
        title: "Codex",
        allowDesktopNotificationWhenAgentActive: true
      ),
      semantic: .completion
    )

    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == [hiddenPane.paneID])
  }

  @Test
  func viewingZoomedTabClearsOnlyVisibleAgentCompletions() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let visibleSurface = try #require(host.selectedSurfaceView)
    let hiddenPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: false,
        target: .pane(visibleSurface.id)
      )
    )
    #expect(host.performSplitAction(.toggleSplitZoom, for: visibleSurface.id))

    let visibleCompletion = TerminalAgentCompletionIdentity.native(
      agent: .codex,
      sessionID: "visible"
    )
    let hiddenCompletion = TerminalAgentCompletionIdentity.native(
      agent: .codex,
      sessionID: "hidden"
    )
    host.agentCompletionStore.record(visibleCompletion, for: visibleSurface.id)
    host.agentCompletionStore.record(hiddenCompletion, for: hiddenPane.paneID)

    for surfaceID in [visibleSurface.id, hiddenPane.paneID] {
      _ = try host.notifyStructuredAgent(
        TerminalNotifyRequest(
          body: "Done.",
          target: .pane(surfaceID),
          title: "Codex",
          allowDesktopNotificationWhenAgentActive: true
        ),
        semantic: .completion
      )
    }

    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.clearAgentCompletionAttention(in: tabID)

    #expect(host.agentCompletionStore.identity(for: visibleSurface.id) == nil)
    #expect(host.agentCompletionStore.identity(for: hiddenPane.paneID) == hiddenCompletion)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == [hiddenPane.paneID])
  }

  @Test
  func notifySuppressesDesktopDeliveryWhenAgentIsRunning() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let expectedTitle = try #require(host.tabs.first(where: { $0.id == tabID })?.title)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setTestAgentActivity(.pi(.running), for: surface.id))

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
  func fallbackActivityDoesNotSuppressDesktopDelivery() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let surface = try #require(host.selectedSurfaceView)
    #expect(
      host.applyAgentDetection(
        TerminalAgentDetectionObservation(
          agent: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
          phase: .running,
          processIdentity: TerminalAgentProcessIdentity(
            processID: 42,
            startTimeMicroseconds: 1
          ),
          ruleID: "screen_running",
          generation: 1,
          sequence: 1
        ),
        for: surface.id
      )
    )

    let result = try host.notify(
      TerminalNotifyRequest(
        body: "Build finished",
        target: .pane(surface.id),
        title: nil
      )
    )

    #expect(result.desktopNotificationDisposition == .deliver)
  }

  @Test
  func notifyAggregatesMultipleNotificationsOnSameSurface() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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

    let host = TerminalHostState.test()
    host.windowActivity = .inactive
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)

    #expect(!host.hasUnreadSidebarNotifications)

    host.ensureInitialTab(focusing: false, startupCommand: nil)

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

    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }

    host.handleDirectInteraction(on: surface.id)

    #expect(!host.hasUnreadSidebarNotifications)
  }

  @Test
  func selectingTabPrefersUnreadPaneFromBackgroundSplit() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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
    let secondSurfaceView = try #require(host.surfaces[secondSurface.paneID])
    let window = makeWindow()
    attachTerminalSurfaces(
      [firstSurface, secondSurfaceView],
      to: window,
      focusing: firstSurface
    )
    defer { window.contentView = nil }

    _ = try host.notify(
      TerminalNotifyRequest(
        body: "Claude needs your attention",
        target: .pane(secondSurface.paneID),
        title: "Claude Code"
      )
    )

    #expect(host.selectedSurfaceView?.id == firstSurface.id)
    #expect(host.unreadNotifiedSurfaceIDs(in: firstTabID) == Set([secondSurface.paneID]))

    _ = host.createTab(inheritingFromSurfaceID: nil)

    let secondTabID = try #require(host.selectedTabID)
    #expect(secondTabID != firstTabID)

    host.selectTab(firstTabID)

    #expect(window.firstResponder === secondSurfaceView)
    host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))

    #expect(host.selectedTabID == firstTabID)
    #expect(host.selectedSurfaceView?.id == secondSurface.paneID)
    #expect(host.unreadNotificationCount(for: firstTabID) == 0)
    #expect(host.unreadNotifiedSurfaceIDs(in: firstTabID).isEmpty)
    #expect(host.latestNotificationText(for: firstTabID) == nil)
  }

  @Test
  func directKeyboardInteractionClearsSidebarNotificationText() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }

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

    let host = TerminalHostState.test()
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }

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

    let host = TerminalHostState.test()
    host.ensureInitialTab(focusing: false, startupCommand: nil)

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
    title: String,
    origin: TerminalHostState.NotificationOrigin = .generic
  ) -> TerminalHostState.PaneNotification {
    TerminalHostState.PaneNotification(
      attentionState: attentionState,
      body: body,
      createdAt: Date(timeIntervalSince1970: createdAt),
      title: title,
      origin: origin
    )
  }
}
