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
  public let contextPaneID: UUID?
  public let subtitle: String
  public let targetPaneIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetWindowIndex: Int?
  public let title: String?

  public init(
    body: String = "",
    contextPaneID: UUID? = nil,
    subtitle: String = "",
    targetPaneIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetWindowIndex: Int? = nil,
    title: String? = nil
  ) {
    self.body = body
    self.contextPaneID = contextPaneID
    self.subtitle = subtitle
    self.targetPaneIndex = targetPaneIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetWindowIndex = targetWindowIndex
    self.title = Self.normalizedTitle(title)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      body: try container.decodeIfPresent(String.self, forKey: .body) ?? "",
      contextPaneID: try container.decodeIfPresent(UUID.self, forKey: .contextPaneID),
      subtitle: try container.decodeIfPresent(String.self, forKey: .subtitle) ?? "",
      targetPaneIndex: try container.decodeIfPresent(Int.self, forKey: .targetPaneIndex),
      targetSpaceIndex: try container.decodeIfPresent(Int.self, forKey: .targetSpaceIndex),
      targetTabIndex: try container.decodeIfPresent(Int.self, forKey: .targetTabIndex),
      targetWindowIndex: try container.decodeIfPresent(Int.self, forKey: .targetWindowIndex),
      title: try container.decodeIfPresent(String.self, forKey: .title)
    )
  }

  private enum CodingKeys: String, CodingKey {
    case body
    case contextPaneID
    case subtitle
    case targetPaneIndex
    case targetSpaceIndex
    case targetTabIndex
    case targetWindowIndex
    case title
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
