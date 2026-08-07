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

enum TerminalCommandPaletteCommand: Equatable, Sendable {
  case ghosttyBindingAction(String)
  case focusPane(TerminalCommandPaletteFocusTarget)
  case update(UpdateUserAction)
  case submitGitHubIssue
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
  let ghosttyCommands: [GhosttyCommand]
  let ghosttyShortcutDisplayByAction: [String: String]
  let hasFocusedSurface: Bool
  let updateEntries: [TerminalCommandPaletteUpdateEntry]
  let focusTargets: [TerminalCommandPaletteFocusTarget]
  let selectedSpaceID: TerminalSpaceID?
  let spaces: [TerminalSpaceItem]
  let selectedTabID: TerminalTabID?
  let rootItems: [TerminalTabRootItem]

  var visibleTabs: [TerminalTabItem] {
    rootItems.flatMap(\.tabs)
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
    return rootItems.contains { item in
      guard case .tab(let tab) = item else { return false }
      return tab.tab.id == selectedTabID && tab.isPinned
    }
  }

  static let empty = Self(
    ghosttyCommands: [],
    ghosttyShortcutDisplayByAction: [:],
    hasFocusedSurface: false,
    updateEntries: [],
    focusTargets: [],
    selectedSpaceID: nil,
    spaces: [],
    selectedTabID: nil,
    rootItems: []
  )
}

enum TerminalCommandPalettePresentation {
  static func rows(from snapshot: TerminalCommandPaletteSnapshot) -> [TerminalCommandPaletteRow] {
    var rows = sortRows(contextRows(from: snapshot))
    rows.append(contentsOf: snapshot.updateEntries.map(updateRow))
    return rows
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

  private static func ghosttyRow(
    _ command: GhosttyCommand,
    shortcut: String?
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: "ghostty:\(command.action)",
      title: command.title,
      subtitle: nil,
      description: command.description.isEmpty ? nil : command.description,
      leadingIcon: nil,
      badge: nil,
      emphasis: false,
      shortcut: shortcut,
      command: .ghosttyBindingAction(command.action)
    )
  }

  private static func updateRow(
    _ entry: TerminalCommandPaletteUpdateEntry
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: "update:\(entry.id)",
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.description,
      leadingIcon: entry.leadingIcon,
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
      title: "Focus: \(target.title)",
      subtitle: target.subtitle,
      description: nil,
      leadingIcon: "rectangle.on.rectangle",
      badge: nil,
      emphasis: false,
      shortcut: nil,
      command: .focusPane(target)
    )
  }

  private static func contextRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    var rows = snapshot.focusTargets.map(focusRow)
    rows.append(contentsOf: ghosttyRows(from: snapshot))
    rows.append(contentsOf: supatermRows(from: snapshot))
    return rows
  }

  private static func ghosttyRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    guard snapshot.hasFocusedSurface else { return [] }
    return snapshot.ghosttyCommands.map { command in
      ghosttyRow(
        command,
        shortcut: snapshot.ghosttyShortcutDisplayByAction[command.action]
      )
    }
  }

  private static func supatermRows(
    from snapshot: TerminalCommandPaletteSnapshot
  ) -> [TerminalCommandPaletteRow] {
    var rows = baseSupatermRows

    if let renameSpaceRow = renameSpaceRow(from: snapshot) {
      rows.append(renameSpaceRow)
    }

    if let togglePinnedRow = togglePinnedRow(from: snapshot) {
      rows.append(togglePinnedRow)
    }

    rows.append(contentsOf: spaceRows(from: snapshot))
    rows.append(contentsOf: tabRows(from: snapshot))
    return rows
  }

  private static var baseSupatermRows: [TerminalCommandPaletteRow] {
    @Shared(.supatermSettings) var supatermSettings = .default
    return [
      TerminalCommandPaletteRow(
        id: "supaterm:toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "View",
        description: nil,
        leadingIcon: nil,
        badge: nil,
        emphasis: false,
        shortcut: SupatermShortcuts.binding(
          for: .toggleSidebar,
          overrides: supatermSettings.shortcutOverrides
        )?.display,
        command: .toggleSidebar
      ),
      TerminalCommandPaletteRow(
        id: "supaterm:submit-github-issue",
        title: "Submit GitHub Issue",
        subtitle: "Help",
        description: nil,
        leadingIcon: nil,
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .submitGitHubIssue
      ),
      TerminalCommandPaletteRow(
        id: "supaterm:create-space",
        title: "Create Space",
        subtitle: "Spaces",
        description: nil,
        leadingIcon: nil,
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .createSpace
      ),
    ]
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
      leadingIcon: nil,
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
      leadingIcon: nil,
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
        title: "Switch to \(space.name)",
        subtitle: "Space",
        description: nil,
        leadingIcon: nil,
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
        title: "Switch to \(tab.title)",
        subtitle: "Tab",
        description: nil,
        leadingIcon: nil,
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .selectTab(tab.id)
      )
    }
  }

  private static func sortRows(_ rows: [TerminalCommandPaletteRow]) -> [TerminalCommandPaletteRow] {
    rows.enumerated()
      .sorted { lhs, rhs in
        let lhsTitle = lhs.element.title.replacingOccurrences(of: ":", with: "\t")
        let rhsTitle = rhs.element.title.replacingOccurrences(of: ":", with: "\t")
        let comparison = lhsTitle.localizedCaseInsensitiveCompare(rhsTitle)
        if comparison != .orderedSame {
          return comparison == .orderedAscending
        }
        return lhs.offset < rhs.offset
      }
      .map(\.element)
  }

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
