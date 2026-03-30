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
      activity: .init(isVisible: true, isFocused: true)
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
  func desktopNotificationCallbackStoresUnreadAttentionAndResolvesTabTitleOnBlankTitle() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.handleCommand(.ensureInitialTab(focusing: false))

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
    #expect(notification.subtitle == "")
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
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Deploy complete", "")

    let event = try #require(await iterator.next())
    guard case .notificationReceived(let notification) = event else {
      Issue.record("Expected notificationReceived event.")
      return
    }

    #expect(notification.attentionState == .unread)
    #expect(notification.body == "")
    #expect(notification.desktopNotificationDisposition == .deliver)
    #expect(notification.resolvedTitle == "Deploy complete")
    #expect(notification.sourceSurfaceID == surface.id)
    #expect(notification.subtitle == "")
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
  }

  @Test
  func desktopNotificationCallbackKeepsDistinctNotificationAfterStructuredCompletion() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notifyStructuredAgent(
      .init(
        body: "Done.",
        subtitle: "Turn complete",
        target: .contextPane(surface.id),
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
  func notifySuppressesDesktopDeliveryWhenAgentIsRunning() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let expectedTitle = try #require(host.tabs.first(where: { $0.id == tabID })?.title)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setAgentActivity(.claude(.running), for: surface.id))

    let result = try host.notify(
      .init(
        body: "Build finished",
        subtitle: "",
        target: .contextPane(surface.id),
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
  func commandFinishedClearsAgentActivity() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setAgentActivity(.claude(.running), for: surface.id))

    surface.bridge.onCommandFinished?()

    #expect(host.agentActivity(for: tabID) == nil)
  }

  @Test
  func notifyAggregatesMultipleNotificationsOnSameSurface() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .inactive
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      .init(
        body: "Build finished",
        subtitle: "",
        target: .contextPane(surface.id),
        title: "Build"
      )
    )
    _ = try host.notify(
      .init(
        body: "Deploy complete",
        subtitle: "",
        target: .contextPane(surface.id),
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
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondSurface = try host.createPane(
      .init(
        command: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .contextPane(firstSurface.id)
      )
    )

    _ = try host.notify(
      .init(
        body: "Build finished",
        subtitle: "",
        target: .contextPane(firstSurface.id),
        title: "Build"
      )
    )
    _ = try host.notify(
      .init(
        body: "Deploy complete",
        subtitle: "",
        target: .contextPane(secondSurface.paneID),
        title: "Deploy"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 2)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([firstSurface.id, secondSurface.paneID]))
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
  }

  @Test
  func directKeyboardInteractionClearsSidebarNotificationText() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      .init(
        body: "Claude needs your attention",
        subtitle: "Needs input",
        target: .contextPane(surface.id),
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
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    _ = try host.notify(
      .init(
        body: "Claude needs your attention",
        subtitle: "Needs input",
        target: .contextPane(surface.id),
        title: "Claude Code"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))

    host.windowActivity = .inactive

    _ = try host.notify(
      .init(
        body: "Build finished",
        subtitle: "",
        target: .contextPane(surface.id),
        title: "Build"
      )
    )

    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID) == Set([surface.id]))

    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    host.handleDirectInteraction(on: surface.id)

    #expect(host.latestNotificationText(for: tabID) == nil)
    #expect(host.unreadNotificationCount(for: tabID) == 0)
    #expect(host.unreadNotifiedSurfaceIDs(in: tabID).isEmpty)
  }

  private func makeNotification(
    attentionState: SupatermNotificationAttentionState?,
    body: String = "",
    createdAt: TimeInterval,
    title: String
  ) -> TerminalHostState.PaneNotification {
    .init(
      attentionState: attentionState,
      body: body,
      createdAt: .init(timeIntervalSince1970: createdAt),
      subtitle: "",
      title: title
    )
  }
}
