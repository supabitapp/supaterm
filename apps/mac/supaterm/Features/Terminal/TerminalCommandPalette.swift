import Foundation
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

  var searchableText: String {
    [title, subtitle]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")
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
  let visibleTabs: [TerminalTabItem]

  var selectedSpace: TerminalSpaceItem? {
    guard let selectedSpaceID else { return nil }
    return spaces.first { $0.id == selectedSpaceID }
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return visibleTabs.first { $0.id == selectedTabID }
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
    visibleTabs: []
  )
}

enum TerminalCommandPalettePresentation {
  private static let toggleSidebarShortcut = KeyboardShortcut("s", modifiers: .command).display

  static func rows(from snapshot: TerminalCommandPaletteSnapshot) -> [TerminalCommandPaletteRow] {
    var rows = snapshot.updateEntries.map(updateRow)
    rows.append(contentsOf: sortRows(contextRows(from: snapshot)))
    return rows
  }

  static func visibleRows(
    from snapshot: TerminalCommandPaletteSnapshot,
    query: String
  ) -> [TerminalCommandPaletteRow] {
    visibleRows(in: rows(from: snapshot), query: query)
  }

  static func visibleRows(
    in rows: [TerminalCommandPaletteRow],
    query: String
  ) -> [TerminalCommandPaletteRow] {
    guard !query.isEmpty else { return rows }

    let normalizedQuery = query.lowercased()
    let matchedRows: [MatchedRow] = rows.enumerated().compactMap { index, row in
      guard row.searchableText.lowercased().contains(normalizedQuery) else {
        return nil
      }
      return .init(index: index, row: row)
    }

    return
      matchedRows
      .sorted { lhs, rhs in
        lhs.index < rhs.index
      }
      .map(\.row)
  }

  static func normalizedSelection(
    _ selectedRowID: TerminalCommandPaletteRow.ID?,
    in visibleRows: [TerminalCommandPaletteRow]
  ) -> TerminalCommandPaletteRow.ID? {
    guard !visibleRows.isEmpty else { return nil }
    guard let selectedRowID, visibleRows.contains(where: { $0.id == selectedRowID }) else {
      return visibleRows[0].id
    }
    return selectedRowID
  }

  static func movedSelection(
    _ selectedRowID: TerminalCommandPaletteRow.ID?,
    by offset: Int,
    in visibleRows: [TerminalCommandPaletteRow]
  ) -> TerminalCommandPaletteRow.ID? {
    guard !visibleRows.isEmpty else { return nil }
    guard let currentSelection = normalizedSelection(selectedRowID, in: visibleRows) else {
      return offset < 0 ? visibleRows.last?.id : visibleRows.first?.id
    }
    let currentIndex =
      visibleRows.firstIndex(where: { $0.id == currentSelection })
      ?? 0
    let nextIndex = (currentIndex + offset).wrappedIndex(modulo: visibleRows.count)
    return visibleRows[nextIndex].id
  }

  static func selectedIndex(
    _ selectedRowID: TerminalCommandPaletteRow.ID?,
    in visibleRows: [TerminalCommandPaletteRow]
  ) -> Int? {
    guard let selectedRowID = normalizedSelection(selectedRowID, in: visibleRows) else { return nil }
    return visibleRows.firstIndex(where: { $0.id == selectedRowID })
  }

  static func row(
    atVisibleIndex index: Int,
    in visibleRows: [TerminalCommandPaletteRow]
  ) -> TerminalCommandPaletteRow? {
    guard visibleRows.indices.contains(index) else { return nil }
    return visibleRows[index]
  }

  static func rowForSlot(
    _ slot: Int,
    in visibleRows: [TerminalCommandPaletteRow]
  ) -> TerminalCommandPaletteRow? {
    row(atVisibleIndex: slot - 1, in: visibleRows)
  }

  private static func ghosttyRow(
    _ command: GhosttyCommand,
    shortcut: String?
  ) -> TerminalCommandPaletteRow {
    .init(
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
    .init(
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
    .init(
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
    [
      .init(
        id: "supaterm:toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "View",
        description: nil,
        leadingIcon: nil,
        badge: nil,
        emphasis: false,
        shortcut: toggleSidebarShortcut,
        command: .toggleSidebar
      ),
      .init(
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
      .init(
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

    return .init(
      id: "supaterm:rename-space:\(selectedSpace.id.rawValue.uuidString)",
      title: "Rename Space",
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

    return .init(
      id: "supaterm:toggle-pinned:\(selectedTab.id.rawValue.uuidString)",
      title: selectedTab.isPinned ? "Unpin Tab" : "Pin Tab",
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
    snapshot.spaces.compactMap { space in
      guard space.id != snapshot.selectedSpaceID else { return nil }
      return .init(
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
    snapshot.visibleTabs.compactMap { tab in
      guard tab.id != snapshot.selectedTabID else { return nil }
      return .init(
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

private struct MatchedRow {
  let index: Int
  let row: TerminalCommandPaletteRow
}

extension Int {
  fileprivate func wrappedIndex(modulo count: Int) -> Int {
    guard count > 0 else { return 0 }
    let remainder = self % count
    return remainder >= 0 ? remainder : remainder + count
  }
}
