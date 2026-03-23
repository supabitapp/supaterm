import Foundation
import GhosttyKit
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateNotificationTests {
  @Test
  func keyboardActivityClearsUnreadNotificationWithoutDroppingLatestText() {
    let notification = TerminalHostState.PaneNotification(
      body: "Build finished",
      createdAt: .init(timeIntervalSince1970: 1),
      isUnread: true,
      subtitle: "",
      title: "Notification"
    )

    let updatedNotification = TerminalHostState.notificationAfterKeyboardActivity(
      notification,
      activity: .init(isVisible: true, isFocused: true)
    )

    #expect(updatedNotification?.isUnread == false)
    #expect(TerminalHostState.notificationText(updatedNotification) == "Build finished")
  }

  @Test
  func latestNotificationUsesNewestTimestamp() {
    let older = TerminalHostState.PaneNotification(
      body: "older",
      createdAt: .init(timeIntervalSince1970: 1),
      isUnread: true,
      subtitle: "",
      title: "Older"
    )
    let newer = TerminalHostState.PaneNotification(
      body: "newer",
      createdAt: .init(timeIntervalSince1970: 2),
      isUnread: false,
      subtitle: "",
      title: "Newer"
    )

    #expect(
      TerminalHostState.latestNotification(in: [older, newer]) == newer
    )
  }

  @Test
  func unreadNotificationCountCountsOnlyUnreadNotifications() {
    let notifications = [
      TerminalHostState.PaneNotification(
        body: "",
        createdAt: .init(timeIntervalSince1970: 1),
        isUnread: true,
        subtitle: "",
        title: "One"
      ),
      TerminalHostState.PaneNotification(
        body: "",
        createdAt: .init(timeIntervalSince1970: 2),
        isUnread: false,
        subtitle: "",
        title: "Two"
      ),
      TerminalHostState.PaneNotification(
        body: "",
        createdAt: .init(timeIntervalSince1970: 3),
        isUnread: true,
        subtitle: "",
        title: "Three"
      ),
    ]

    #expect(
      TerminalHostState.unreadNotificationCount(in: notifications) == 2
    )
  }

  @Test
  func notificationTextPrefersBodyThenFallsBackToTrimmedTitle() {
    let bodyFirst = TerminalHostState.PaneNotification(
      body: "  Build finished  ",
      createdAt: .init(timeIntervalSince1970: 1),
      isUnread: true,
      subtitle: "",
      title: "Deploy complete"
    )
    let titleFallback = TerminalHostState.PaneNotification(
      body: "   ",
      createdAt: .init(timeIntervalSince1970: 2),
      isUnread: true,
      subtitle: "",
      title: "  Deploy complete  "
    )
    let blank = TerminalHostState.PaneNotification(
      body: " ",
      createdAt: .init(timeIntervalSince1970: 3),
      isUnread: true,
      subtitle: "",
      title: " "
    )

    #expect(TerminalHostState.notificationText(bodyFirst) == "Build finished")
    #expect(TerminalHostState.notificationText(titleFallback) == "Deploy complete")
    #expect(TerminalHostState.notificationText(blank) == nil)
  }

  @Test
  func desktopNotificationCallbackUpdatesUnreadStateAndNormalizesTitle() async throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    let stream = host.eventStream()
    var iterator = stream.makeAsyncIterator()
    host.handleCommand(.ensureInitialTab(focusing: false))

    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("   ", "Build finished")

    let event = try #require(await iterator.next())
    guard case .notificationReceived(let notification) = event else {
      Issue.record("Expected notificationReceived event.")
      return
    }

    #expect(notification.body == "Build finished")
    #expect(notification.shouldDeliverDesktopNotification == false)
    #expect(notification.sourceSurfaceID == surface.id)
    #expect(notification.subtitle == "")
    #expect(notification.title == SupatermNotifyRequest.defaultTitle)
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Build finished")
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

    #expect(notification.body == "")
    #expect(notification.shouldDeliverDesktopNotification == true)
    #expect(notification.sourceSurfaceID == surface.id)
    #expect(notification.subtitle == "")
    #expect(notification.title == "Deploy complete")
    #expect(host.unreadNotificationCount(for: tabID) == 1)
    #expect(host.latestNotificationText(for: tabID) == "Deploy complete")
  }
}

private let ghosttyInitializedForTests: Void = {
  let macRootURL =
    URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
  let ghosttyResourcesURL = macRootURL.appendingPathComponent(".build/ghostty/share/ghostty", isDirectory: true)
  let terminfoURL = macRootURL.appendingPathComponent(".build/ghostty/share/terminfo", isDirectory: true)
  setenv("GHOSTTY_RESOURCES_DIR", ghosttyResourcesURL.path, 1)
  setenv("TERMINFO_DIRS", terminfoURL.path, 1)

  let argc = UInt(1)
  let argv0 = strdup("supaterm-tests")
  defer {
    free(argv0)
  }
  let argv = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: 2)
  argv.initialize(to: argv0)
  argv.advanced(by: 1).initialize(to: nil)
  defer {
    argv.advanced(by: 1).deinitialize(count: 1)
    argv.deinitialize(count: 1)
    argv.deallocate()
  }

  let result = ghostty_init(argc, argv)
  precondition(result == GHOSTTY_SUCCESS)
}()

private func initializeGhosttyForTests() {
  _ = ghosttyInitializedForTests
}
