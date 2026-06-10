import Foundation

struct TerminalNotificationStore {
  static let coalescingWindow: TimeInterval = 2

  private var notificationsBySurfaceID: [UUID: [TerminalHostState.PaneNotification]] = [:]
  private var recentStructuredBySurfaceID: [UUID: TerminalHostState.RecentStructuredNotification] =
    [:]

  func notifications(for surfaceID: UUID) -> [TerminalHostState.PaneNotification]? {
    notificationsBySurfaceID[surfaceID]
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

  mutating func recentStructured(
    for surfaceID: UUID,
    at now: Date = Date()
  ) -> TerminalHostState.RecentStructuredNotification? {
    guard let notification = recentStructuredBySurfaceID[surfaceID] else { return nil }
    guard now.timeIntervalSince(notification.recordedAt) <= Self.coalescingWindow else {
      recentStructuredBySurfaceID.removeValue(forKey: surfaceID)
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
}
