import Foundation
import Sharing
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct TerminalCommandPaletteState: Equatable {
  var query = ""
  var selectedRowID: TerminalCommandPaletteRow.ID?
}

struct TerminalCommandPaletteFocusTarget: Equatable, Sendable {
  let windowControllerID: UUID
  let surfaceID: UUID
  let title: String
  let subtitle: String?
}

struct TerminalCommandPaletteUpdateEntry: Equatable, Sendable {
  let id: String
  let title: String
  let subtitle: String?
  let description: String?
  let leadingIcon: String?
  let badge: String?
  let emphasis: Bool
  let action: UpdateUserAction
}

nonisolated enum TerminalCommandPaletteAppAction: Hashable, Sendable {
  case copyAgentSessionID
  case forkAgentSession
  case jumpToLatestUnread
  case openPullRequest
  case openSettings
  case toggleAgentPanel
}

enum TerminalCommandPaletteCommand: Equatable, Sendable {
  case app(TerminalCommandPaletteAppAction)
  case closeOtherTabs(keeping: [TerminalTabID])
  case closePane(UUID)
  case closeTab(TerminalTabID)
  case ghosttyBindingAction(String)
  case focusPane(TerminalCommandPaletteFocusTarget)
  case update(UpdateUserAction)
  case toggleSidebar
  case createSpace
  case renameSpace(TerminalSpaceItem)
  case togglePinned(TerminalTabID)
  case selectSpace(TerminalSpaceID)
  case selectTab(TerminalTabID)
}

struct TerminalCommandPaletteRow: Equatable, Identifiable, Sendable {
  let id: String
  let title: String
  let subtitle: String?
  let description: String?
  let leadingIcon: String?
  let badge: String?
  let emphasis: Bool
  let shortcut: String?
  let command: TerminalCommandPaletteCommand
}

struct TerminalCommandPaletteMatch: Equatable, Identifiable, Sendable {
  enum MatchedCharacter: Equatable, Sendable {
    case title(Int)
    case subtitle(Int)
    case description(Int)

    fileprivate var searchRank: Int {
      switch self {
      case .title: 0
      case .subtitle: 1
      case .description: 2
      }
    }
  }

  let row: TerminalCommandPaletteRow
  let matchedCharacters: [MatchedCharacter]

  var id: TerminalCommandPaletteRow.ID { row.id }

  var titleMatchedCharacterOffsets: [Int] {
    matchedCharacters.compactMap { character in
      guard case .title(let offset) = character else { return nil }
      return offset
    }
  }

  var displaySubtitle: String? {
    displaysDescription ? row.description : row.subtitle
  }

  var displaySubtitleMatchedCharacterOffsets: [Int] {
    if displaysDescription {
      return matchedCharacters.compactMap { character in
        guard case .description(let offset) = character else { return nil }
        return offset
      }
    }

    return matchedCharacters.compactMap { character in
      guard case .subtitle(let offset) = character else { return nil }
      return offset
    }
  }

  fileprivate var searchRank: Int {
    matchedCharacters.reduce(0) { rank, character in
      max(rank, character.searchRank)
    }
  }

  private var displaysDescription: Bool {
    guard row.subtitle != nil else { return true }
    return matchedCharacters.contains { character in
      guard case .description = character else { return false }
      return true
    }
  }
}

struct TerminalCommandPaletteSnapshot: Equatable, Sendable {
  let availableAppActions: Set<TerminalCommandPaletteAppAction>
  let ghosttyShortcutDisplayByAction: [String: String]
  let updateEntries: [TerminalCommandPaletteUpdateEntry]
  let focusTargets: [TerminalCommandPaletteFocusTarget]
  let selectedSurfaceID: UUID?
  let selectedTabPaneCount: Int
  let selectedPaneIsZoomed: Bool
  let selectedSpaceID: TerminalSpaceID?
  let spaces: [TerminalSpaceItem]
  let selectedTabID: TerminalTabID?
  let tabs: [TerminalTabItem]

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  var selectedSpace: TerminalSpaceItem? {
    guard let selectedSpaceID else { return nil }
    return spaces.first { $0.id == selectedSpaceID }
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return visibleTabs.first { $0.id == selectedTabID }
  }

  var selectedTabIsPinned: Bool {
    guard let selectedTabID else { return false }
    return tabs.first(where: { $0.id == selectedTabID })?.isPinned == true
  }

  var hasFocusedSurface: Bool {
    selectedSurfaceID != nil
  }

  var selectedTabIsSplit: Bool {
    selectedTabPaneCount > 1
  }

  nonisolated static let empty = Self(
    availableAppActions: [],
    ghosttyShortcutDisplayByAction: [:],
    updateEntries: [],
    focusTargets: [],
    selectedSurfaceID: nil,
    selectedTabPaneCount: 0,
    selectedPaneIsZoomed: false,
    selectedSpaceID: nil,
    spaces: [],
    selectedTabID: nil,
    tabs: []
  )
}

enum TerminalCommandPalettePresentation {
  static let clearScreenAction = "clear_screen"
  static let openSettingsAction = "open_config"
  static let shortcutBindingActions = [
    SupatermCommand.newSplit(.right).ghosttyBindingAction,
    SupatermCommand.newSplit(.down).ghosttyBindingAction,
    SupatermCommand.toggleSplitZoom.ghosttyBindingAction,
    SupatermCommand.equalizeSplits.ghosttyBindingAction,
    SupatermCommand.promptTabTitle.ghosttyBindingAction,
    SupatermCommand.promptSurfaceTitle.ghosttyBindingAction,
    SupatermCommand.startSearch.ghosttyBindingAction,
    clearScreenAction,
    SupatermCommand.closeSurface.ghosttyBindingAction,
    SupatermCommand.closeTab.ghosttyBindingAction,
    openSettingsAction,
  ]

  static func rows(from snapshot: TerminalCommandPaletteSnapshot) -> [TerminalCommandPaletteRow] {
    let updateRows = snapshot.updateEntries.map(updateRow)
    return updateRows.filter(\.emphasis)
      + attentionRows(from: snapshot)
      + agentRows(from: snapshot)
      + spaceRows(from: snapshot)
      + tabRows(from: snapshot)
      + focusRows(from: snapshot)
      + layoutRows(from: snapshot)
      + workspaceRows(from: snapshot)
      + terminalUtilityRows(from: snapshot)
      + interfaceRows(from: snapshot)
      + updateRows.filter { !$0.emphasis }
  }

  static func matches(
    from snapshot: TerminalCommandPaletteSnapshot,
    query: String
  ) -> [TerminalCommandPaletteMatch] {
    matches(in: rows(from: snapshot), query: query)
  }

  static func matches(
    in rows: [TerminalCommandPaletteRow],
    query: String
  ) -> [TerminalCommandPaletteMatch] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
      return rows.map { row in
        TerminalCommandPaletteMatch(row: row, matchedCharacters: [])
      }
    }

    let matches: [(sourceOffset: Int, match: TerminalCommandPaletteMatch)] = rows.enumerated().compactMap {
      sourceOffset, row in
      let searchableContent = searchableContent(for: row)
      guard let indices = matchedIndices(in: searchableContent.text, for: query) else {
        return nil
      }
      let matchedCharacters = indices.compactMap { index in
        searchableContent.characterSources[
          searchableContent.text.distance(from: searchableContent.text.startIndex, to: index)
        ]
      }
      return (
        sourceOffset: sourceOffset,
        match: TerminalCommandPaletteMatch(row: row, matchedCharacters: matchedCharacters)
      )
    }

    return matches.sorted { lhs, rhs in
      if lhs.match.searchRank != rhs.match.searchRank {
        return lhs.match.searchRank < rhs.match.searchRank
      }
      return lhs.sourceOffset < rhs.sourceOffset
    }
    .map(\.match)
  }

  static func normalizedSelection(
    _ selectedRowID: TerminalCommandPaletteRow.ID?,
    in matches: [TerminalCommandPaletteMatch]
  ) -> TerminalCommandPaletteRow.ID? {
    guard !matches.isEmpty else { return nil }
    guard let selectedRowID, matches.contains(where: { $0.id == selectedRowID }) else {
      return matches[0].id
    }
    return selectedRowID
  }

  static func movedSelection(
    _ selectedRowID: TerminalCommandPaletteRow.ID?,
    by offset: Int,
    in matches: [TerminalCommandPaletteMatch]
  ) -> TerminalCommandPaletteRow.ID? {
    guard !matches.isEmpty else { return nil }
    guard let currentSelection = normalizedSelection(selectedRowID, in: matches) else {
      return offset < 0 ? matches.last?.id : matches.first?.id
    }
    let currentIndex =
      matches.firstIndex(where: { $0.id == currentSelection })
      ?? 0
    let nextIndex = (currentIndex + offset).wrappedIndex(modulo: matches.count)
    return matches[nextIndex].id
  }

  static func row(
    atVisibleIndex index: Int,
    in matches: [TerminalCommandPaletteMatch]
  ) -> TerminalCommandPaletteRow? {
    guard matches.indices.contains(index) else { return nil }
    return matches[index].row
  }

  static func rowForSlot(
    _ slot: Int,
    in matches: [TerminalCommandPaletteMatch]
  ) -> TerminalCommandPaletteRow? {
    row(atVisibleIndex: slot - 1, in: matches)
  }

  private static func searchableContent(
    for row: TerminalCommandPaletteRow
  ) -> SearchableContent {
    var text = ""
    var characterSources: [TerminalCommandPaletteMatch.MatchedCharacter?] = []
    appendSearchableText(
      row.title,
      source: TerminalCommandPaletteMatch.MatchedCharacter.title,
      to: &text,
      characterSources: &characterSources
    )
    if let subtitle = row.subtitle {
      appendSearchableText(
        subtitle,
        source: TerminalCommandPaletteMatch.MatchedCharacter.subtitle,
        to: &text,
        characterSources: &characterSources
      )
    }
    if let description = row.description {
      appendSearchableText(
        description,
        source: TerminalCommandPaletteMatch.MatchedCharacter.description,
        to: &text,
        characterSources: &characterSources
      )
    }
    return SearchableContent(text: text, characterSources: characterSources)
  }

  private static func appendSearchableText(
    _ rawText: String,
    source: (Int) -> TerminalCommandPaletteMatch.MatchedCharacter,
    to text: inout String,
    characterSources: inout [TerminalCommandPaletteMatch.MatchedCharacter?]
  ) {
    let trimmedText = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedText.isEmpty, let range = rawText.range(of: trimmedText) else { return }

    if !text.isEmpty {
      text.append(" ")
      characterSources.append(nil)
    }

    let sourceOffset = rawText.distance(from: rawText.startIndex, to: range.lowerBound)
    for (offset, character) in trimmedText.enumerated() {
      text.append(character)
      characterSources.append(source(sourceOffset + offset))
    }
  }

  private static func matchedIndices(
    in text: String,
    for query: String
  ) -> [String.Index]? {
    if let range = text.range(of: query, options: .caseInsensitive) {
      return Array(text[range].indices)
    }

    var queryIndex = query.startIndex
    var indices: [String.Index] = []

    for word in text.split(whereSeparator: \.isWhitespace) {
      guard queryIndex < query.endIndex else { break }
      guard word.first?.lowercased() == query[queryIndex].lowercased() else { continue }
      indices.append(word.startIndex)
      queryIndex = query.index(after: queryIndex)
    }

    return queryIndex == query.endIndex ? indices : nil
  }

  private static func updateRow(
    _ entry: TerminalCommandPaletteUpdateEntry
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: "update:\(entry.id)",
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.description,
      leadingIcon: entry.leadingIcon ?? "arrow.down.circle",
      badge: entry.badge,
      emphasis: entry.emphasis,
      shortcut: nil,
      command: .update(entry.action)
    )
  }

  private static func focusRow(
    _ target: TerminalCommandPaletteFocusTarget
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: "focus:\(target.windowControllerID.uuidString):\(target.surfaceID.uuidString)",
      title: target.title,
      subtitle: target.subtitle,
      description: "Focus this pane.",
      leadingIcon: "rectangle.on.rectangle",
      badge: nil,
      emphasis: false,
      shortcut: nil,
      command: .focusPane(target)
    )
  }

  private static func attentionRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    appRows([.jumpToLatestUnread], from: snapshot)
  }

  private static func agentRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    appRows(
      [.openPullRequest, .forkAgentSession, .copyAgentSessionID, .toggleAgentPanel],
      from: snapshot
    )
  }

  private static func appRows(
    _ actions: [TerminalCommandPaletteAppAction],
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    actions.compactMap { action in
      guard snapshot.availableAppActions.contains(action) else { return nil }
      return appRow(action, shortcutDisplayByAction: snapshot.ghosttyShortcutDisplayByAction)
    }
  }

  private static func appRow(
    _ action: TerminalCommandPaletteAppAction,
    shortcutDisplayByAction: [String: String]
  ) -> TerminalCommandPaletteRow {
    @Shared(.supatermSettings) var supatermSettings = .default
    let definition: AppRowDefinition =
      switch action {
      case .copyAgentSessionID:
        AppRowDefinition(
          id: "app:copy-agent-session-id",
          title: "Copy Agent Session ID",
          subtitle: "Agent",
          icon: "doc.on.doc",
          shortcutID: .copyAgentSessionID
        )
      case .forkAgentSession:
        AppRowDefinition(
          id: "app:fork-agent-session",
          title: "Fork Agent Session",
          subtitle: "Agent",
          icon: "plus.forwardslash.minus",
          shortcutID: .forkAgentSession
        )
      case .jumpToLatestUnread:
        AppRowDefinition(
          id: "app:jump-to-latest-unread",
          title: "Jump to Latest Unread",
          subtitle: "Attention",
          icon: "bell.badge",
          shortcutID: .jumpToLatestUnread
        )
      case .openPullRequest:
        AppRowDefinition(
          id: "app:open-pull-request",
          title: "Open Pull Request",
          subtitle: "Agent",
          icon: "arrow.up.right.square",
          shortcutID: .openPullRequest
        )
      case .openSettings:
        AppRowDefinition(
          id: "app:open-settings",
          title: "Open Settings",
          subtitle: "Application",
          icon: "gearshape",
          shortcutID: nil
        )
      case .toggleAgentPanel:
        AppRowDefinition(
          id: "app:toggle-agent-panel",
          title: "Toggle Agent Panel",
          subtitle: "Agent",
          icon: "sidebar.right",
          shortcutID: .toggleAgentPanel
        )
      }
    let shortcut: String?
    if let shortcutID = definition.shortcutID {
      shortcut =
        SupatermShortcuts.binding(
          for: shortcutID,
          overrides: supatermSettings.shortcutOverrides
        )?.display
    } else {
      shortcut = shortcutDisplayByAction[openSettingsAction]
    }
    return TerminalCommandPaletteRow(
      id: definition.id,
      title: definition.title,
      subtitle: definition.subtitle,
      description: nil,
      leadingIcon: definition.icon,
      badge: nil,
      emphasis: false,
      shortcut: shortcut,
      command: .app(action)
    )
  }

  private static func renameSpaceRow(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> TerminalCommandPaletteRow? {
    guard let selectedSpace = snapshot.selectedSpace else { return nil }

    return TerminalCommandPaletteRow(
      id: "supaterm:rename-space:\(selectedSpace.id.rawValue.uuidString)",
      title: "Edit Space",
      subtitle: selectedSpace.name,
      description: nil,
      leadingIcon: "pencil.line",
      badge: nil,
      emphasis: false,
      shortcut: nil,
      command: .renameSpace(selectedSpace)
    )
  }

  private static func togglePinnedRow(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> TerminalCommandPaletteRow? {
    guard let selectedTab = snapshot.selectedTab else { return nil }

    return TerminalCommandPaletteRow(
      id: "supaterm:toggle-pinned:\(selectedTab.id.rawValue.uuidString)",
      title: snapshot.selectedTabIsPinned ? "Unpin Tab" : "Pin Tab",
      subtitle: selectedTab.title,
      description: nil,
      leadingIcon: snapshot.selectedTabIsPinned ? "pin.slash" : "pin",
      badge: nil,
      emphasis: false,
      shortcut: nil,
      command: .togglePinned(selectedTab.id)
    )
  }

  private static func spaceRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    snapshot.spaces.compactMap { space -> TerminalCommandPaletteRow? in
      guard space.id != snapshot.selectedSpaceID else { return nil }
      return TerminalCommandPaletteRow(
        id: "supaterm:space:\(space.id.rawValue.uuidString)",
        title: space.name,
        subtitle: "Space",
        description: "Switch to space \(space.name).",
        leadingIcon: "rectangle.3.group",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .selectSpace(space.id)
      )
    }
  }

  private static func tabRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    snapshot.visibleTabs.compactMap { tab -> TerminalCommandPaletteRow? in
      guard tab.id != snapshot.selectedTabID else { return nil }
      return TerminalCommandPaletteRow(
        id: "supaterm:tab:\(tab.id.rawValue.uuidString)",
        title: tab.title,
        subtitle: "Tab",
        description: "Switch to tab \(tab.title).",
        leadingIcon: "macwindow",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .selectTab(tab.id)
      )
    }
  }

  private static func focusRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    snapshot.focusTargets.compactMap { target in
      guard target.surfaceID != snapshot.selectedSurfaceID else { return nil }
      return focusRow(target)
    }
  }

  private static func layoutRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    guard snapshot.hasFocusedSurface else { return [] }
    var rows = [
      bindingRow(
        BindingRowDefinition(
          id: "terminal:split-right",
          title: "Split Pane Right",
          subtitle: "Layout",
          description: "Split the focused pane to the right.",
          icon: "rectangle.split.2x1",
          action: SupatermCommand.newSplit(.right).ghosttyBindingAction
        ),
        snapshot: snapshot
      ),
      bindingRow(
        BindingRowDefinition(
          id: "terminal:split-down",
          title: "Split Pane Down",
          subtitle: "Layout",
          description: "Split the focused pane below.",
          icon: "rectangle.split.1x2",
          action: SupatermCommand.newSplit(.down).ghosttyBindingAction
        ),
        snapshot: snapshot
      ),
    ]
    guard snapshot.selectedTabIsSplit else { return rows }
    rows.append(
      bindingRow(
        BindingRowDefinition(
          id: "terminal:toggle-pane-zoom",
          title: snapshot.selectedPaneIsZoomed ? "Unzoom Pane" : "Zoom Pane",
          subtitle: "Layout",
          description: "Toggle the focused pane between full size and its split layout.",
          icon: snapshot.selectedPaneIsZoomed
            ? "arrow.down.right.and.arrow.up.left"
            : "arrow.up.left.and.arrow.down.right",
          action: SupatermCommand.toggleSplitZoom.ghosttyBindingAction
        ),
        snapshot: snapshot
      )
    )
    rows.append(
      bindingRow(
        BindingRowDefinition(
          id: "terminal:equalize-panes",
          title: "Equalize Panes",
          subtitle: "Layout",
          description: "Give each pane equal space.",
          icon: "equal.square",
          action: SupatermCommand.equalizeSplits.ghosttyBindingAction
        ),
        snapshot: snapshot
      )
    )
    return rows
  }

  private static func workspaceRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    var rows: [TerminalCommandPaletteRow] = []
    if let row = togglePinnedRow(from: snapshot) {
      rows.append(row)
    }
    if let row = renameSpaceRow(from: snapshot) {
      rows.append(row)
    }
    if snapshot.selectedTab != nil, snapshot.hasFocusedSurface {
      rows.append(
        bindingRow(
          BindingRowDefinition(
            id: "terminal:rename-tab",
            title: "Rename Tab",
            subtitle: snapshot.selectedTab?.title,
            description: nil,
            icon: "textformat",
            action: SupatermCommand.promptTabTitle.ghosttyBindingAction
          ),
          snapshot: snapshot
        )
      )
      rows.append(
        bindingRow(
          BindingRowDefinition(
            id: "terminal:rename-pane",
            title: "Rename Pane",
            subtitle: "Current Pane",
            description: nil,
            icon: "pencil.line",
            action: SupatermCommand.promptSurfaceTitle.ghosttyBindingAction
          ),
          snapshot: snapshot
        )
      )
    }
    rows.append(
      TerminalCommandPaletteRow(
        id: "supaterm:create-space",
        title: "Create Space",
        subtitle: "Spaces",
        description: nil,
        leadingIcon: "plus.rectangle.on.rectangle",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .createSpace
      )
    )
    return rows
  }

  private static func terminalUtilityRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    guard snapshot.hasFocusedSurface else { return [] }
    var rows = [
      bindingRow(
        BindingRowDefinition(
          id: "terminal:find",
          title: "Find in Terminal",
          subtitle: "Terminal",
          description: nil,
          icon: "magnifyingglass",
          action: SupatermCommand.startSearch.ghosttyBindingAction
        ),
        snapshot: snapshot
      ),
      bindingRow(
        BindingRowDefinition(
          id: "terminal:clear-screen",
          title: "Clear Screen and Scrollback",
          subtitle: "Terminal",
          description: nil,
          icon: "eraser",
          action: clearScreenAction
        ),
        snapshot: snapshot
      ),
    ]
    if let selectedTabID = snapshot.selectedTabID, snapshot.visibleTabs.count > 1 {
      rows.append(
        TerminalCommandPaletteRow(
          id: "terminal:close-other-tabs",
          title: "Close Other Tabs",
          subtitle: "Tabs",
          description: "Close every visible tab except the current tab.",
          leadingIcon: "rectangle.stack.badge.minus",
          badge: nil,
          emphasis: false,
          shortcut: nil,
          command: .closeOtherTabs(keeping: [selectedTabID])
        )
      )
    }
    if let selectedSurfaceID = snapshot.selectedSurfaceID, snapshot.selectedTabIsSplit {
      rows.append(
        TerminalCommandPaletteRow(
          id: "terminal:close-pane",
          title: "Close Pane",
          subtitle: "Terminal",
          description: nil,
          leadingIcon: "xmark.square",
          badge: nil,
          emphasis: false,
          shortcut: snapshot.ghosttyShortcutDisplayByAction[
            SupatermCommand.closeSurface.ghosttyBindingAction
          ],
          command: .closePane(selectedSurfaceID)
        )
      )
    }
    if let selectedTabID = snapshot.selectedTabID {
      rows.append(
        TerminalCommandPaletteRow(
          id: "terminal:close-tab",
          title: "Close Tab",
          subtitle: snapshot.selectedTab?.title,
          description: nil,
          leadingIcon: "xmark",
          badge: nil,
          emphasis: false,
          shortcut: snapshot.ghosttyShortcutDisplayByAction[
            SupatermCommand.closeTab.ghosttyBindingAction
          ],
          command: .closeTab(selectedTabID)
        )
      )
    }
    return rows
  }

  private static func interfaceRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    @Shared(.supatermSettings) var supatermSettings = .default
    var rows = [
      TerminalCommandPaletteRow(
        id: "supaterm:toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "View",
        description: nil,
        leadingIcon: "sidebar.left",
        badge: nil,
        emphasis: false,
        shortcut: SupatermShortcuts.binding(
          for: .toggleSidebar,
          overrides: supatermSettings.shortcutOverrides
        )?.display,
        command: .toggleSidebar
      )
    ]
    rows.append(contentsOf: appRows([.openSettings], from: snapshot))
    return rows
  }

  private static func bindingRow(
    _ definition: BindingRowDefinition,
    snapshot: TerminalCommandPaletteSnapshot
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: definition.id,
      title: definition.title,
      subtitle: definition.subtitle,
      description: definition.description,
      leadingIcon: definition.icon,
      badge: nil,
      emphasis: false,
      shortcut: snapshot.ghosttyShortcutDisplayByAction[definition.action],
      command: .ghosttyBindingAction(definition.action)
    )
  }
}

private struct AppRowDefinition {
  let id: String
  let title: String
  let subtitle: String
  let icon: String
  let shortcutID: SupatermShortcutID?
}

private struct BindingRowDefinition {
  let id: String
  let title: String
  let subtitle: String?
  let description: String?
  let icon: String
  let action: String
}

private struct SearchableContent {
  let text: String
  let characterSources: [TerminalCommandPaletteMatch.MatchedCharacter?]
}

extension Int {
  fileprivate func wrappedIndex(modulo count: Int) -> Int {
    guard count > 0 else { return 0 }
    let remainder = self % count
    return remainder >= 0 ? remainder : remainder + count
  }
}
