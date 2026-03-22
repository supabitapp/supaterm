import Foundation
import Testing

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
}
