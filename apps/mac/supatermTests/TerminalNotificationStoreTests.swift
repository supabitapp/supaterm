import Foundation
import Testing

@testable import SupatermTerminalFeature
@testable import supaterm

struct TerminalNotificationStoreTests {
  private func makeNotification(createdAt: TimeInterval = 1) -> TerminalHostState.PaneNotification {
    TerminalHostState.PaneNotification(
      attentionState: .unread,
      body: "body",
      createdAt: Date(timeIntervalSince1970: createdAt),
      title: "title"
    )
  }

  @Test
  func appendAccumulatesNotificationsPerSurface() {
    var store = TerminalNotificationStore()
    let surfaceID = UUID()

    store.append(makeNotification(createdAt: 1), for: surfaceID)
    store.append(makeNotification(createdAt: 2), for: surfaceID)

    #expect(store.notifications(for: surfaceID)?.count == 2)
    #expect(store.notifications(for: UUID()) == nil)
  }

  @Test
  func replacingWithEmptyNotificationsRemovesSurfaceEntry() {
    var store = TerminalNotificationStore()
    let surfaceID = UUID()
    store.append(makeNotification(), for: surfaceID)

    store.replaceNotifications([], for: surfaceID)

    #expect(store.notifications(for: surfaceID) == nil)
  }

  @Test
  func recentStructuredExpiresAfterCoalescingWindow() {
    var store = TerminalNotificationStore()
    let surfaceID = UUID()
    let recordedAt = Date()
    store.setRecentStructured(
      TerminalHostState.RecentStructuredNotification(
        recordedAt: recordedAt,
        semantic: .completion,
        text: "Done"
      ),
      for: surfaceID
    )

    let withinWindow = recordedAt.addingTimeInterval(TerminalNotificationStore.coalescingWindow)
    #expect(store.recentStructured(for: surfaceID, at: withinWindow)?.text == "Done")

    let afterWindow = recordedAt.addingTimeInterval(TerminalNotificationStore.coalescingWindow + 1)
    #expect(store.recentStructured(for: surfaceID, at: afterWindow) == nil)
  }

  @Test
  func clearRecentStructuredReportsWhetherEntryExisted() {
    var store = TerminalNotificationStore()
    let surfaceID = UUID()
    store.setRecentStructured(
      TerminalHostState.RecentStructuredNotification(
        recordedAt: Date(),
        semantic: .attention,
        text: "Needs input"
      ),
      for: surfaceID
    )

    let firstClear = store.clearRecentStructured(for: surfaceID)
    let secondClear = store.clearRecentStructured(for: surfaceID)

    #expect(firstClear)
    #expect(!secondClear)
  }

  @Test
  func removeSurfaceClearsAllState() {
    var store = TerminalNotificationStore()
    let surfaceID = UUID()
    store.append(makeNotification(), for: surfaceID)
    store.setRecentStructured(
      TerminalHostState.RecentStructuredNotification(
        recordedAt: Date(),
        semantic: .completion,
        text: "Done"
      ),
      for: surfaceID
    )

    store.removeSurface(surfaceID)

    let recentStructured = store.recentStructured(for: surfaceID)
    #expect(store.notifications(for: surfaceID) == nil)
    #expect(recentStructured == nil)
  }
}
