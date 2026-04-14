import Foundation
import FuzzyMatch
import SwiftUI

struct TerminalCommandPaletteState: Equatable {
  var query = ""
  var selectedRowID: TerminalCommandPaletteRow.ID?
}

enum TerminalCommandPaletteCommand: Equatable, Sendable {
  case ghosttyBindingAction(String)
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
  let subtitle: String
  let shortcut: String?
  let command: TerminalCommandPaletteCommand

  var searchableText: String {
    "\(title) \(subtitle)"
  }
}

struct TerminalCommandPaletteSnapshot: Equatable, Sendable {
  let ghosttyCommands: [GhosttyCommand]
  let ghosttyShortcutDisplayByAction: [String: String]
  let hasFocusedSurface: Bool
  let selectedSpaceID: TerminalSpaceID?
  let spaces: [TerminalSpaceItem]
  let selectedTabID: TerminalTabID?
  let visibleTabs: [TerminalTabItem]

  static let empty = Self(
    ghosttyCommands: [],
    ghosttyShortcutDisplayByAction: [:],
    hasFocusedSurface: false,
    selectedSpaceID: nil,
    spaces: [],
    selectedTabID: nil,
    visibleTabs: []
  )
}

enum TerminalCommandPalettePresentation {
  private static let matcher = FuzzyMatcher()
  private static let toggleSidebarShortcut = KeyboardShortcut("s", modifiers: .command).display

  static func rows(from snapshot: TerminalCommandPaletteSnapshot) -> [TerminalCommandPaletteRow] {
    var rows: [TerminalCommandPaletteRow] = []

    if snapshot.hasFocusedSurface {
      rows.append(
        contentsOf: snapshot.ghosttyCommands.map { command in
          ghosttyRow(
            command,
            shortcut: snapshot.ghosttyShortcutDisplayByAction[command.action]
          )
        })
    }

    rows.append(
      .init(
        id: "supaterm:toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "View",
        shortcut: toggleSidebarShortcut,
        command: .toggleSidebar
      )
    )
    rows.append(
      .init(
        id: "supaterm:submit-github-issue",
        title: "Submit GitHub Issue",
        subtitle: "Help",
        shortcut: nil,
        command: .submitGitHubIssue
      )
    )
    rows.append(
      .init(
        id: "supaterm:create-space",
        title: "Create Space",
        subtitle: "Spaces",
        shortcut: nil,
        command: .createSpace
      )
    )

    if let selectedSpace = snapshot.selectedSpaceID.flatMap({ selectedSpaceID in
      snapshot.spaces.first(where: { $0.id == selectedSpaceID })
    }) {
      rows.append(
        .init(
          id: "supaterm:rename-space:\(selectedSpace.id.rawValue.uuidString)",
          title: "Rename Space",
          subtitle: selectedSpace.name,
          shortcut: nil,
          command: .renameSpace(selectedSpace)
        )
      )
    }

    if let selectedTab = snapshot.selectedTabID.flatMap({ selectedTabID in
      snapshot.visibleTabs.first(where: { $0.id == selectedTabID })
    }) {
      rows.append(
        .init(
          id: "supaterm:toggle-pinned:\(selectedTab.id.rawValue.uuidString)",
          title: selectedTab.isPinned ? "Unpin Tab" : "Pin Tab",
          subtitle: selectedTab.title,
          shortcut: nil,
          command: .togglePinned(selectedTab.id)
        )
      )
    }

    rows.append(
      contentsOf: snapshot.spaces.compactMap { space in
        guard space.id != snapshot.selectedSpaceID else { return nil }
        return .init(
          id: "supaterm:space:\(space.id.rawValue.uuidString)",
          title: "Switch to \(space.name)",
          subtitle: "Space",
          shortcut: nil,
          command: .selectSpace(space.id)
        )
      })

    rows.append(
      contentsOf: snapshot.visibleTabs.compactMap { tab in
        guard tab.id != snapshot.selectedTabID else { return nil }
        return .init(
          id: "supaterm:tab:\(tab.id.rawValue.uuidString)",
          title: "Switch to \(tab.title)",
          subtitle: "Tab",
          shortcut: nil,
          command: .selectTab(tab.id)
        )
      })

    return rows
  }

  static func visibleRows(
    in rows: [TerminalCommandPaletteRow],
    query: String
  ) -> [TerminalCommandPaletteRow] {
    guard !query.isEmpty else { return rows }

    let preparedQuery = matcher.prepare(query)
    var buffer = matcher.makeBuffer()
    let scoredRows: [ScoredRow] = rows.enumerated().compactMap { index, row in
      guard let match = matcher.score(row.searchableText, against: preparedQuery, buffer: &buffer) else {
        return nil
      }
      return .init(index: index, row: row, score: match.score)
    }

    return
      scoredRows
      .sorted { lhs, rhs in
        if lhs.score == rhs.score {
          return lhs.index < rhs.index
        }
        return lhs.score > rhs.score
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
    let currentSelection = normalizedSelection(selectedRowID, in: visibleRows)
    let currentIndex =
      currentSelection.flatMap { selectedRowID in
        visibleRows.firstIndex(where: { $0.id == selectedRowID })
      } ?? 0
    let nextIndex = min(max(currentIndex + offset, 0), visibleRows.count - 1)
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
      subtitle: command.description.isEmpty ? "Terminal" : command.description,
      shortcut: shortcut,
      command: .ghosttyBindingAction(command.action)
    )
  }
}

private struct ScoredRow {
  let index: Int
  let row: TerminalCommandPaletteRow
  let score: Double
}
