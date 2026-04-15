import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  var spaces: [TerminalSpaceItem] {
    spaceManager.spaces
  }

  var selectedSpaceID: TerminalSpaceID? {
    spaceManager.selectedSpaceID
  }

  var tabs: [TerminalTabItem] {
    spaceManager.tabs
  }

  var pinnedTabs: [TerminalTabItem] {
    spaceManager.pinnedTabs
  }

  var regularTabs: [TerminalTabItem] {
    spaceManager.regularTabs
  }

  var visibleTabs: [TerminalTabItem] {
    spaceManager.visibleTabs
  }

  var selectedTabID: TerminalTabID? {
    spaceManager.selectedTabID
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return spaceManager.tab(for: selectedTabID)
  }

  var selectedTree: SplitTree<GhosttySurfaceView>? {
    guard let selectedTabID else { return nil }
    return splitTree(for: selectedTabID)
  }

  var selectedSurfaceView: GhosttySurfaceView? {
    guard
      let selectedTabID,
      let focusedSurfaceID = focusedSurfaceIDByTab[selectedTabID]
    else {
      return nil
    }
    return surfaces[focusedSurfaceID]
  }

  var selectedSurfaceState: GhosttySurfaceState? {
    selectedSurfaceView?.bridge.state
  }

  func sidebarTerminalProgress(for tabID: TerminalTabID) -> TerminalSidebarTerminalProgress? {
    Self.sidebarTerminalProgress(
      state: focusedSurfaceIDByTab[tabID].flatMap { surfaceID in
        surfaces[surfaceID]?.bridge.state
      }
    )
  }

  var selectedPaneIsZoomed: Bool {
    Self.isPaneZoomed(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree
    )
  }

  var selectedPaneDisplayTitle: String {
    Self.selectedPaneDisplayTitle(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree,
      titleOverride: { $0.bridge.state.titleOverride },
      title: { $0.bridge.state.title },
      pwd: { $0.bridge.state.pwd }
    )
  }

  func contextSurfaceID(for tabID: TerminalTabID) -> UUID? {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID], surfaces[focusedSurfaceID] != nil {
      return focusedSurfaceID
    }
    return trees[tabID]?.root?.leftmostLeaf().id
  }

  func paneWorkingDirectories(for tabID: TerminalTabID) -> [String] {
    Self.paneWorkingDirectories(
      in: splitTree(for: tabID),
      pwd: { $0.bridge.state.pwd }
    )
  }

  var terminalBackgroundColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.backgroundColor() ?? .windowBackgroundColor)
  }

  var terminalChromeColorScheme: ColorScheme {
    _ = runtimeConfigGeneration
    if let runtime {
      return runtime.chromeColorScheme()
    }
    let appearance = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
    return appearance == .darkAqua ? .dark : .light
  }

  var terminalChromeAppearance: NSAppearance {
    switch terminalChromeColorScheme {
    case .light:
      NSAppearance(named: .aqua) ?? NSAppearance(named: .darkAqua)!
    case .dark:
      NSAppearance(named: .darkAqua) ?? NSAppearance(named: .aqua)!
    @unknown default:
      NSAppearance(named: .darkAqua) ?? NSAppearance(named: .aqua)!
    }
  }

  var notificationAttentionColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.notificationAttentionColor() ?? .controlAccentColor)
  }

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

  func latestSidebarNotificationPresentation(
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

  func unreadNotificationCount(for tabID: TerminalTabID) -> Int {
    unreadNotifiedSurfaceIDs(in: tabID).count
  }

  func unreadNotifiedSurfaceIDs(in tabID: TerminalTabID) -> Set<UUID> {
    Set(
      notifications(for: tabID)
        .compactMap { surfaceID, notifications in
          Self.surfaceAttentionState(in: notifications) == .unread ? surfaceID : nil
        }
    )
  }

  func tabAgentPresentation(for tabID: TerminalTabID) -> TabAgentPresentation {
    guard let tree = trees[tabID] else {
      return .init(badgeActivity: nil, detailActivity: nil, hoverMarkdown: nil)
    }

    let focusedSurfaceID = focusedSurfaceIDByTab[tabID]
    let detailActivity = focusedSurfaceID.flatMap { paneAgentMetadataBySurfaceID[$0]?.activity }
    let hoverMarkdown = focusedSurfaceID.flatMap {
      Self.codexHoverMarkdown(
        paneAgentMetadataBySurfaceID[$0]?.codexHoverMessages ?? []
      )
    }

    var badgeActivity: AgentActivity?
    var badgePriority = Int.min
    var badgeSurfaceIsFocused = false
    var badgeActivityRevision = Int.min
    var badgeLeafIndex = Int.max

    for (leafIndex, surface) in tree.leaves().enumerated() {
      guard
        let metadata = paneAgentMetadataBySurfaceID[surface.id],
        let activity = metadata.activity
      else {
        continue
      }

      let priority = Self.agentActivityPriority(activity.phase)
      let isFocused = surface.id == focusedSurfaceID
      let activityRevision = metadata.activityRevision ?? Int.min

      if badgeActivity == nil
        || priority > badgePriority
        || (priority == badgePriority && isFocused && !badgeSurfaceIsFocused)
        || (priority == badgePriority && isFocused == badgeSurfaceIsFocused
          && activityRevision > badgeActivityRevision)
        || (priority == badgePriority && isFocused == badgeSurfaceIsFocused
          && activityRevision == badgeActivityRevision && leafIndex < badgeLeafIndex)
      {
        badgeActivity = activity
        badgePriority = priority
        badgeSurfaceIsFocused = isFocused
        badgeActivityRevision = activityRevision
        badgeLeafIndex = leafIndex
      }
    }

    return .init(
      badgeActivity: badgeActivity,
      detailActivity: detailActivity,
      hoverMarkdown: hoverMarkdown
    )
  }

  func agentActivity(for tabID: TerminalTabID) -> AgentActivity? {
    tabAgentPresentation(for: tabID).badgeActivity
  }

  func codexHoverMarkdown(for tabID: TerminalTabID) -> String? {
    tabAgentPresentation(for: tabID).hoverMarkdown
  }

  func showsAgentActivityDetail(for tabID: TerminalTabID) -> Bool {
    tabAgentPresentation(for: tabID).detailActivity != nil
  }

  @discardableResult
  func setAgentActivity(_ activity: AgentActivity, for surfaceID: UUID) -> Bool {
    guard tabID(containing: surfaceID) != nil else { return false }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? .init()
    metadata.activity = activity
    metadata.activityRevision = nextAgentActivityRevision
    nextAgentActivityRevision += 1
    paneAgentMetadataBySurfaceID[surfaceID] = metadata
    return true
  }

  @discardableResult
  func clearAgentActivity(for surfaceID: UUID) -> Bool {
    guard tabID(containing: surfaceID) != nil else { return false }
    guard var metadata = paneAgentMetadataBySurfaceID[surfaceID] else { return true }
    metadata.activity = nil
    metadata.activityRevision = nil
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  @discardableResult
  func clearCodexHoverMessages(for surfaceID: UUID) -> Bool {
    guard tabID(containing: surfaceID) != nil else { return false }
    guard var metadata = paneAgentMetadataBySurfaceID[surfaceID] else { return true }
    metadata.codexHoverMessages = []
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  @discardableResult
  func recordCodexHoverMessages(
    _ messages: [String],
    replacing: Bool,
    for surfaceID: UUID
  ) -> Bool {
    guard tabID(containing: surfaceID) != nil else { return false }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? .init()
    var nextMessages = replacing ? [] : metadata.codexHoverMessages
    for message in messages.compactMap(normalizedTerminalAgentDetail) where nextMessages.last != message {
      nextMessages.append(message)
    }
    metadata.codexHoverMessages = nextMessages
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  static func agentActivityPriority(_ phase: AgentActivityPhase) -> Int {
    switch phase {
    case .needsInput:
      return 2
    case .running:
      return 1
    case .idle:
      return 0
    }
  }

  static func codexHoverMarkdown(_ messages: [String]) -> String? {
    guard !messages.isEmpty else { return nil }
    return messages.joined(separator: "\n\n")
  }

  func storePaneAgentMetadata(_ metadata: PaneAgentMetadata, for surfaceID: UUID) {
    if metadata.isEmpty {
      paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID)
    } else {
      paneAgentMetadataBySurfaceID[surfaceID] = metadata
    }
  }

  static func selectedPaneDisplayTitle<Surface: NSView & Identifiable>(
    focusedSurfaceID: UUID?,
    in tree: SplitTree<Surface>?,
    titleOverride: (Surface) -> String?,
    title: (Surface) -> String?,
    pwd: (Surface) -> String?
  ) -> String where Surface.ID == UUID {
    let leaves = tree?.leaves() ?? []
    guard
      let surface = focusedSurfaceID.flatMap({ id in leaves.first(where: { $0.id == id }) })
        ?? leaves.first
    else {
      return "Pane"
    }
    return resolvedPaneDisplayTitle(
      titleOverride: titleOverride(surface),
      title: title(surface),
      pwd: pwd(surface),
      defaultValue: paneFallbackTitle(for: surface.id, in: tree)
    )
  }

  static func paneWorkingDirectories<Surface: NSView & Identifiable>(
    in tree: SplitTree<Surface>?,
    pwd: (Surface) -> String?
  ) -> [String] where Surface.ID == UUID {
    var seen = Set<String>()
    return (tree?.leaves() ?? []).compactMap { surface in
      guard let path = trimmedNonEmpty(pwd(surface)) else { return nil }
      let normalized = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
      guard seen.insert(normalized).inserted else { return nil }
      return (normalized as NSString).abbreviatingWithTildeInPath
    }
  }

  static func isPaneZoomed<Surface: NSView & Identifiable>(
    focusedSurfaceID: UUID?,
    in tree: SplitTree<Surface>?
  ) -> Bool where Surface.ID == UUID {
    guard
      let focusedSurfaceID,
      let zoomedSurfaceID = tree?.zoomed?.leftmostLeaf().id
    else {
      return false
    }
    return focusedSurfaceID == zoomedSurfaceID
  }

  static func resolvedPaneDisplayTitle(
    titleOverride: String?,
    title: String?,
    pwd: String?,
    defaultValue: String
  ) -> String {
    if let titleOverride {
      return titleOverride
    }
    if let title, !title.isEmpty {
      return title
    }
    if let pwd = trimmedNonEmpty(pwd) {
      return pwd
    }
    return defaultValue
  }

  static func resolvedTabDisplayTitle(
    titleOverride: String?,
    title: String?,
    pwd: String?,
    defaultValue: String
  ) -> String {
    if let titleOverride {
      return titleOverride
    }
    if let title = trimmedNonEmpty(title) {
      var resolved = strippedLeadingWorkingDirectory(from: title, pwd: pwd) ?? title
      while let stripped = strippedDuplicatedTrailingCommandSuffix(from: resolved),
        stripped != resolved
      {
        resolved = stripped
      }
      return resolved
    }
    if let pwd = trimmedNonEmpty(pwd) {
      return pwd
    }
    return defaultValue
  }

  static func paneFallbackTitle<Surface: NSView & Identifiable>(
    for surfaceID: UUID?,
    in tree: SplitTree<Surface>?
  ) -> String where Surface.ID == UUID {
    let leaves = tree?.leaves() ?? []
    guard !leaves.isEmpty else { return "Pane" }
    if let surfaceID, let index = leaves.firstIndex(where: { $0.id == surfaceID }) {
      return "Pane \(index + 1)"
    }
    return "Pane 1"
  }

  static func isRunning(
    progressState: ghostty_action_progress_report_state_e?
  ) -> Bool {
    switch progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET),
      .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE),
      .some(GHOSTTY_PROGRESS_STATE_PAUSE),
      .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return true
    default:
      return false
    }
  }

  static func progressStateDescription(
    _ progressState: ghostty_action_progress_report_state_e?
  ) -> String? {
    switch progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET):
      return "set"
    case .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE):
      return "indeterminate"
    case .some(GHOSTTY_PROGRESS_STATE_PAUSE):
      return "pause"
    case .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return "error"
    case .some(GHOSTTY_PROGRESS_STATE_REMOVE):
      return "remove"
    default:
      return nil
    }
  }

  static func sidebarTerminalProgress(
    state: GhosttySurfaceState?
  ) -> TerminalSidebarTerminalProgress? {
    guard let state else { return nil }

    switch state.progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .active
      )
    case .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE):
      return .init(fraction: nil, tone: .active)
    case .some(GHOSTTY_PROGRESS_STATE_PAUSE):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 } ?? 1,
        tone: .paused
      )
    case .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .error
      )
    default:
      return nil
    }
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
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)
      return
    }
    recentStructuredNotificationsBySurfaceID[surfaceID] = .init(
      recordedAt: createdAt,
      semantic: semantic,
      text: text
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
      var notifications = paneNotifications[surfaceID]
    else {
      return
    }
    let now = Date()
    guard
      let index = notifications.indices.reversed().first(where: { index in
        let notification = notifications[index]
        guard
          notification.origin == .terminalDesktop,
          now.timeIntervalSince(notification.createdAt) <= Self.notificationCoalescingWindow,
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
    if notifications.isEmpty {
      paneNotifications.removeValue(forKey: surfaceID)
    } else {
      paneNotifications[surfaceID] = notifications
    }
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
    guard let notification = recentStructuredNotificationsBySurfaceID[surfaceID] else {
      return nil
    }
    guard Date().timeIntervalSince(notification.recordedAt) <= Self.notificationCoalescingWindow
    else {
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)
      return nil
    }
    return notification
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
    return .init(
      markdown: markdown,
      previewMarkdown: sidebarNotificationPreviewMarkdown(markdown)
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

  static let notificationCoalescingWindow: TimeInterval = 2

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

  static func trimmedNonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }

  static func strippedLeadingWorkingDirectory(
    from title: String,
    pwd: String?
  ) -> String? {
    guard let pwd = trimmedNonEmpty(pwd) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(pwd)
    let abbreviatedPath = (normalizedPath as NSString).abbreviatingWithTildeInPath
    let prefixes = Set([normalizedPath, abbreviatedPath]).sorted { $0.count > $1.count }

    for prefix in prefixes where title.hasPrefix(prefix) {
      let suffix = String(title.dropFirst(prefix.count))
      guard let strippedSuffix = strippedTitleSeparator(from: suffix) else { continue }
      return strippedSuffix
    }

    return nil
  }

  static func strippedTitleSeparator(
    from value: String
  ) -> String? {
    let separatorCharacters =
      CharacterSet.whitespacesAndNewlines
      .union(.punctuationCharacters)
      .union(CharacterSet(charactersIn: "·•›»—–"))
    guard let firstScalar = value.unicodeScalars.first,
      separatorCharacters.contains(firstScalar)
    else {
      return nil
    }

    let stripped = String(
      value.unicodeScalars.drop(while: { separatorCharacters.contains($0) })
    ).trimmingCharacters(in: .whitespacesAndNewlines)

    return stripped.isEmpty ? nil : stripped
  }

  static func strippedDuplicatedTrailingCommandSuffix(
    from title: String
  ) -> String? {
    guard let separatorRange = title.range(of: " - ", options: .backwards) else { return nil }
    let prefix = String(title[..<separatorRange.lowerBound]).trimmingCharacters(
      in: .whitespacesAndNewlines)
    let suffix = String(title[separatorRange.upperBound...]).trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard
      let prefixCommand = leadingCommandToken(in: prefix),
      let suffixCommand = trimmedNonEmpty(suffix),
      prefixCommand == suffixCommand
    else {
      return nil
    }
    return prefix
  }

  static func leadingCommandToken(
    in value: String
  ) -> String? {
    guard let trimmed = trimmedNonEmpty(value) else { return nil }
    return trimmed.split(whereSeparator: \.isWhitespace).first.map(String.init)
  }
}

extension GhosttySurfaceView {
  var needsCloseConfirmation: Bool {
    guard let surface else { return false }
    return ghostty_surface_needs_confirm_quit(surface)
  }

  func resolvedDisplayTitle(defaultValue: String) -> String {
    TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: bridge.state.titleOverride,
      title: bridge.state.title,
      pwd: bridge.state.pwd,
      defaultValue: defaultValue
    )
  }
}
