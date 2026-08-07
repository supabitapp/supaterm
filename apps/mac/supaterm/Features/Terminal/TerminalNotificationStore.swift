import Foundation

struct TerminalNotificationStore {
  struct UnreadTarget: Equatable {
    let createdAt: Date
    let surfaceID: UUID

    func isOlder(than other: Self) -> Bool {
      if createdAt != other.createdAt {
        return createdAt < other.createdAt
      }
      return surfaceID.uuidString < other.surfaceID.uuidString
    }
  }

  static let coalescingWindow: TimeInterval = 2

  private var notificationsBySurfaceID: [UUID: [TerminalHostState.PaneNotification]] = [:]
  private var recentStructuredBySurfaceID: [UUID: TerminalHostState.RecentStructuredNotification] =
    [:]

  func notifications(for surfaceID: UUID) -> [TerminalHostState.PaneNotification]? {
    notificationsBySurfaceID[surfaceID]
  }

  func latestUnreadTarget(
    among surfaceIDs: some Sequence<UUID>
  ) -> UnreadTarget? {
    surfaceIDs
      .compactMap { surfaceID in
        notificationsBySurfaceID[surfaceID]?
          .filter { $0.attentionState == .unread }
          .max { $0.createdAt < $1.createdAt }
          .map { UnreadTarget(createdAt: $0.createdAt, surfaceID: surfaceID) }
      }
      .max { $0.isOlder(than: $1) }
  }

  mutating func append(
    _ notification: TerminalHostState.PaneNotification,
    for surfaceID: UUID
  ) {
    notificationsBySurfaceID[surfaceID, default: []].append(notification)
  }

  mutating func replaceNotifications(
    _ notifications: [TerminalHostState.PaneNotification],
    for surfaceID: UUID
  ) {
    if notifications.isEmpty {
      notificationsBySurfaceID.removeValue(forKey: surfaceID)
    } else {
      notificationsBySurfaceID[surfaceID] = notifications
    }
  }

  func recentStructured(
    for surfaceID: UUID,
    at now: Date = Date()
  ) -> TerminalHostState.RecentStructuredNotification? {
    guard
      let notification = recentStructuredBySurfaceID[surfaceID],
      now.timeIntervalSince(notification.recordedAt) <= Self.coalescingWindow
    else {
      return nil
    }
    return notification
  }

  mutating func setRecentStructured(
    _ notification: TerminalHostState.RecentStructuredNotification,
    for surfaceID: UUID
  ) {
    recentStructuredBySurfaceID[surfaceID] = notification
  }

  @discardableResult
  mutating func clearRecentStructured(for surfaceID: UUID) -> Bool {
    recentStructuredBySurfaceID.removeValue(forKey: surfaceID) != nil
  }

  mutating func removeSurface(_ surfaceID: UUID) {
    notificationsBySurfaceID.removeValue(forKey: surfaceID)
    recentStructuredBySurfaceID.removeValue(forKey: surfaceID)
  }

  mutating func take(_ surfaceIDs: Set<UUID>) -> TerminalNotificationStore {
    var taken = TerminalNotificationStore()
    for surfaceID in surfaceIDs {
      if let notifications = notificationsBySurfaceID.removeValue(forKey: surfaceID) {
        taken.notificationsBySurfaceID[surfaceID] = notifications
      }
      if let recent = recentStructuredBySurfaceID.removeValue(forKey: surfaceID) {
        taken.recentStructuredBySurfaceID[surfaceID] = recent
      }
    }
    return taken
  }

  mutating func merge(_ other: TerminalNotificationStore) {
    precondition(notificationsBySurfaceID.keys.allSatisfy { other.notificationsBySurfaceID[$0] == nil })
    precondition(
      recentStructuredBySurfaceID.keys.allSatisfy { other.recentStructuredBySurfaceID[$0] == nil }
    )
    notificationsBySurfaceID.merge(other.notificationsBySurfaceID) { _, incoming in incoming }
    recentStructuredBySurfaceID.merge(other.recentStructuredBySurfaceID) { _, incoming in incoming }
  }
}
