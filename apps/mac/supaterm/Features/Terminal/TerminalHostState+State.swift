import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermGhosttyFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature
import SwiftUI

extension TerminalHostState {
  public var spaces: [TerminalSpaceItem] {
    spaceManager.spaces
  }

  public var selectedSpaceID: TerminalSpaceID? {
    spaceManager.selectedSpaceID
  }

  public var tabs: [TerminalTabItem] {
    spaceManager.tabs
  }

  public var pinnedTabs: [TerminalTabItem] {
    spaceManager.pinnedTabs
  }

  public var regularTabs: [TerminalTabItem] {
    spaceManager.regularTabs
  }

  public var visibleTabs: [TerminalTabItem] {
    spaceManager.visibleTabs
  }

  public var hasUnreadSidebarNotifications: Bool {
    visibleTabs.contains { unreadNotificationCount(for: $0.id) > 0 }
  }

  public var selectedTabID: TerminalTabID? {
    spaceManager.selectedTabID
  }

  public var selectedTree: SplitTree<GhosttySurfaceView>? {
    guard let selectedTabID else { return nil }
    return splitTree(for: selectedTabID)
  }

  public var selectedSurfaceView: GhosttySurfaceView? {
    guard
      let selectedTabID,
      let focusedSurfaceID = focusHistoryByTab[selectedTabID]?.current
    else {
      return nil
    }
    return surfaces[focusedSurfaceID]
  }

  var selectedSurfaceState: GhosttySurfaceState? {
    selectedSurfaceView?.bridge.state
  }

  public var selectedSurfaceID: UUID? {
    selectedSurfaceView?.id
  }

  public var selectedSurfaceHasSearch: Bool {
    selectedSurfaceState?.searchNeedle != nil
  }

  public var hasSelectedSurface: Bool {
    selectedSurfaceView != nil
  }

  public func sidebarTerminalProgress(for tabID: TerminalTabID) -> TerminalSidebarTerminalProgress? {
    Self.sidebarTerminalProgress(
      state: focusHistoryByTab[tabID].map(\.current).flatMap { surfaceID in
        surfaces[surfaceID]?.bridge.state
      }
    )
  }

  public func tabHasBell(for tabID: TerminalTabID) -> Bool {
    trees[tabID]?.leaves().contains {
      $0.bridge.state.bellCount > 0
    } ?? false
  }

  public var selectedPaneIsZoomed: Bool {
    Self.isPaneZoomed(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree
    )
  }

  public var selectedPaneDisplayTitle: String {
    Self.selectedPaneDisplayTitle(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree,
      titleOverride: { $0.bridge.state.titleOverride },
      title: { $0.bridge.state.title },
      pwd: { $0.bridge.state.pwd }
    )
  }

  public func contextSurfaceID(for tabID: TerminalTabID) -> UUID? {
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current, surfaces[focusedSurfaceID] != nil {
      return focusedSurfaceID
    }
    return trees[tabID]?.root?.leftmostLeaf().id
  }

  public func paneWorkingDirectories(for tabID: TerminalTabID) -> [String] {
    if let tree = trees[tabID] {
      return Self.paneWorkingDirectories(
        paths: tree.leaves().map { $0.bridge.state.pwd }
      )
    }
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tab(for: tabID)?.isPinned == true,
      let session = pinnedTabCatalog.tabs(in: spaceID).first(where: { $0.id == tabID })?.session
    else {
      return []
    }
    return Self.paneWorkingDirectories(
      paths: session.root.workingDirectoryPaths
    )
  }

  public var terminalBackgroundColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.backgroundColor() ?? .windowBackgroundColor)
  }

  public var terminalChromeColorScheme: ColorScheme {
    _ = runtimeConfigGeneration
    if let runtime {
      return runtime.chromeColorScheme()
    }
    let appearance = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])
    return appearance == .darkAqua ? .dark : .light
  }

  public var notificationAttentionColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.notificationAttentionColor() ?? .controlAccentColor)
  }

  public var splitDividerColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.splitDividerColor() ?? .separatorColor)
  }

  public var unfocusedSplitDimmingColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.unfocusedSplitDimmingColor() ?? .windowBackgroundColor)
  }

  public var unfocusedSplitDimmingOpacity: Double {
    _ = runtimeConfigGeneration
    return runtime?.unfocusedSplitDimmingOpacity() ?? 0
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
    paneWorkingDirectories(
      paths: (tree?.leaves() ?? []).map(pwd)
    )
  }

  static func paneWorkingDirectories(
    paths: [String?]
  ) -> [String] {
    var seen = Set<String>()
    return paths.compactMap { path in
      guard let path = trimmedNonEmpty(path) else { return nil }
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
      return TerminalSidebarTerminalProgress(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .active
      )
    case .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE):
      return TerminalSidebarTerminalProgress(fraction: nil, tone: .active)
    case .some(GHOSTTY_PROGRESS_STATE_PAUSE):
      return TerminalSidebarTerminalProgress(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 } ?? 1,
        tone: .paused
      )
    case .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return TerminalSidebarTerminalProgress(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .error
      )
    default:
      return nil
    }
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
    return trimmed.split(whereSeparator: \.isWhitespace).first.map { String($0) }
  }
}

extension TerminalPaneNodeSession {
  fileprivate var workingDirectoryPaths: [String?] {
    switch self {
    case .leaf(let leaf):
      return [leaf.workingDirectoryPath]
    case .split(let split):
      return split.left.workingDirectoryPaths + split.right.workingDirectoryPaths
    }
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
