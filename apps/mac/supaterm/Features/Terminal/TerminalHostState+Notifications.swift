import Foundation
import SupatermCLIShared
import SupatermTerminalModels

extension TerminalHostState {
  func latestNotificationText(for tabID: TerminalTabID) -> String? {
    Self.notificationText(
      Self.latestNotification(
        in: notifications(for: tabID)
          .values
          .flatMap { $0 }
          .filter { $0.attentionState != nil }
      )
    )
  }

  public func latestSidebarNotificationPresentation(
    for tabID: TerminalTabID
  ) -> SidebarNotificationPresentation? {
    Self.sidebarNotificationPresentation(
      Self.latestNotification(
        in: notifications(for: tabID)
          .values
          .flatMap { $0 }
          .filter { $0.attentionState != nil }
      )
    )
  }

  func notificationRecordCount(for tabID: TerminalTabID) -> Int {
    notifications(for: tabID)
      .values
      .reduce(into: 0) { $0 += $1.count }
  }

  public func unreadNotificationCount(for tabID: TerminalTabID) -> Int {
    unreadNotifiedSurfaceIDs(in: tabID).count
  }

  public func unreadNotifiedSurfaceIDs(in tabID: TerminalTabID) -> Set<UUID> {
    Set(
      notifications(for: tabID)
        .compactMap { surfaceID, notifications in
          Self.surfaceAttentionState(in: notifications) == .unread ? surfaceID : nil
        }
    )
  }

  func updateRecentStructuredNotificationIfNeeded(
    body: String,
    createdAt: Date,
    origin: NotificationOrigin,
    surfaceID: UUID,
    title: String
  ) {
    guard case .structuredAgent(let semantic) = origin else { return }
    guard
      let text = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      )
    else {
      notificationStore.clearRecentStructured(for: surfaceID)
      return
    }
    notificationStore.setRecentStructured(
      RecentStructuredNotification(
        recordedAt: createdAt,
        semantic: semantic,
        text: text
      ),
      for: surfaceID
    )
  }

  func coalesceStructuredNotificationIfNeeded(
    body: String,
    origin: NotificationOrigin,
    surfaceID: UUID,
    title: String
  ) {
    guard case .structuredAgent(let semantic) = origin else { return }
    guard
      let structuredText = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      ),
      var notifications = notificationStore.notifications(for: surfaceID)
    else {
      return
    }
    let now = Date()
    guard
      let index = notifications.indices.reversed().first(where: { index in
        let notification = notifications[index]
        guard
          notification.origin == .terminalDesktop,
          now.timeIntervalSince(notification.createdAt) <= TerminalNotificationStore.coalescingWindow,
          let terminalText = Self.normalizedNotificationText(Self.notificationText(notification))
        else {
          return false
        }
        return Self.shouldCoalesceTerminalNotification(
          terminalText: terminalText,
          structuredText: structuredText,
          semantic: semantic
        )
      })
    else {
      return
    }
    notifications.remove(at: index)
    notificationStore.replaceNotifications(notifications, for: surfaceID)
  }

  func shouldSuppressDesktopNotification(
    body: String,
    surfaceID: UUID,
    title: String
  ) -> Bool {
    guard
      let terminalText = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      ),
      let recentStructuredNotification = recentStructuredNotification(for: surfaceID)
    else {
      return false
    }
    return Self.shouldCoalesceTerminalNotification(
      terminalText: terminalText,
      structuredText: recentStructuredNotification.text,
      semantic: recentStructuredNotification.semantic
    )
  }

  func recentStructuredNotification(for surfaceID: UUID) -> RecentStructuredNotification? {
    notificationStore.recentStructured(for: surfaceID)
  }

  static func latestNotification(in notifications: [PaneNotification]) -> PaneNotification? {
    notifications.max { lhs, rhs in
      lhs.createdAt < rhs.createdAt
    }
  }

  static func unreadNotificationRecordCount(in notifications: [PaneNotification]) -> Int {
    notifications.filter { $0.attentionState == .unread }.count
  }

  static func surfaceAttentionState(
    in notifications: [PaneNotification]
  ) -> SupatermNotificationAttentionState? {
    if notifications.contains(where: { $0.attentionState == .unread }) {
      return .unread
    }
    return nil
  }

  static func notificationsAfterDirectInteraction(
    _ notifications: [PaneNotification],
    activity: SurfaceActivity
  ) -> [PaneNotification] {
    guard activity.isFocused else { return notifications }
    return notifications.map { notification in
      guard notification.attentionState != nil else { return notification }
      var updatedNotification = notification
      updatedNotification.attentionState = nil
      return updatedNotification
    }
  }

  static func notificationText(_ notification: PaneNotification?) -> String? {
    guard let notification else { return nil }
    return notificationText(body: notification.body, title: notification.title)
  }

  static func sidebarNotificationPresentation(
    _ notification: PaneNotification?
  ) -> SidebarNotificationPresentation? {
    guard let markdown = notificationText(notification) else { return nil }
    let previewMarkdown = sidebarNotificationPreviewMarkdown(markdown)
    return SidebarNotificationPresentation(
      markdown: markdown,
      previewMarkdown: previewMarkdown.isEmpty ? nil : previewMarkdown
    )
  }

  static func notificationText(body: String, title: String) -> String? {
    let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
    if !body.isEmpty {
      return body
    }
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return title.isEmpty ? nil : title
  }

  static func sidebarNotificationPreviewMarkdown(
    _ markdown: String
  ) -> String {
    var preview = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
    let replacements = [
      (#"(?m)^\s*\[[^\]]+\]:\s+\S.*$"#, ""),
      (#"(?m)^\s*(```|~~~).*$"#, ""),
      (#"(?m)^\s{0,3}#{1,6}\s*"#, ""),
      (#"(?m)^\s{0,3}>\s?"#, ""),
      (#"(?m)^\s*[-+*]\s+"#, ""),
      (#"(?m)^\s*\d+[.)]\s+"#, ""),
      (#"(?m)^\s*\[[ xX]\]\s+"#, ""),
      (#"!\[([^\]]*)\]\([^)]+\)"#, "$1"),
      (#"\[([^\]]+)\]\([^)]+\)"#, "$1"),
      (#"\[([^\]]+)\]\[[^\]]*\]"#, "$1"),
      (#"(?i)<(?:https?://|mailto:)[^>]+>"#, ""),
      (#"(?i)\b(?:https?://|mailto:)\S+\b"#, ""),
      (#"(?m)^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"#, ""),
    ]

    for (pattern, template) in replacements {
      preview = replacingMatches(in: preview, pattern: pattern, with: template)
    }

    preview =
      preview
      .split(separator: "\n", omittingEmptySubsequences: true)
      .map { normalizeSidebarNotificationPreviewLine(String($0)) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")

    preview = replacingMatches(in: preview, pattern: #"\s+"#, with: " ", options: [])
    return preview.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func normalizeSidebarNotificationPreviewLine(
    _ line: String
  ) -> String {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }

    let pipeCount = trimmed.reduce(into: 0) { count, character in
      if character == "|" {
        count += 1
      }
    }
    guard trimmed.hasPrefix("|") || trimmed.hasSuffix("|") || pipeCount >= 2 else {
      return trimmed
    }

    let cells =
      trimmed
      .split(separator: "|", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    return cells.joined(separator: " · ")
  }

  static func replacingMatches(
    in string: String,
    pattern: String,
    with template: String,
    options: NSRegularExpression.Options = [.anchorsMatchLines]
  ) -> String {
    guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else {
      return string
    }
    let range = NSRange(string.startIndex..<string.endIndex, in: string)
    return expression.stringByReplacingMatches(
      in: string, options: [], range: range, withTemplate: template)
  }

  static let genericCompletionNotificationTexts: Set<String> = [
    "agent turn complete",
    "task complete",
    "turn complete",
  ]

  static func shouldCoalesceTerminalNotification(
    terminalText: String,
    structuredText: String,
    semantic: NotificationSemantic
  ) -> Bool {
    if terminalText == structuredText {
      return true
    }
    if terminalText.count < structuredText.count,
      structuredText.hasPrefix(terminalText)
    {
      return true
    }
    return semantic == .completion
      && genericCompletionNotificationTexts.contains(terminalText)
  }

  static func normalizedNotificationText(_ value: String?) -> String? {
    guard let value else { return nil }
    let collapsed =
      value
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
      .lowercased()
      .trimmingCharacters(in: .punctuationCharacters)
    return collapsed.isEmpty ? nil : collapsed
  }
}
