import Foundation

public enum SupatermNotificationAttentionState: String, Equatable, Sendable, Codable {
  case unread
}

public enum SupatermDesktopNotificationDisposition: String, Equatable, Sendable, Codable {
  case deliver
  case suppressAgent
  case suppressFocused

  public var shouldDeliver: Bool {
    self == .deliver
  }
}

public struct SupatermNotifyRequest: Equatable, Sendable, Codable {
  public let body: String
  public let paneID: UUID
  public let subtitle: String
  public let title: String?

  public init(
    body: String = "",
    paneID: UUID,
    subtitle: String = "",
    title: String? = nil
  ) {
    self.body = body
    self.paneID = paneID
    self.subtitle = subtitle
    self.title = Self.normalizedTitle(title)
  }

  private static func normalizedTitle(_ title: String?) -> String? {
    let title = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return title.isEmpty ? nil : title
  }
}

public struct SupatermNotifyResult: Equatable, Sendable, Codable {
  public let attentionState: SupatermNotificationAttentionState
  public let desktopNotificationDisposition: SupatermDesktopNotificationDisposition
  public let resolvedTitle: String
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    attentionState: SupatermNotificationAttentionState,
    desktopNotificationDisposition: SupatermDesktopNotificationDisposition,
    resolvedTitle: String,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.attentionState = attentionState
    self.desktopNotificationDisposition = desktopNotificationDisposition
    self.resolvedTitle = resolvedTitle
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}
