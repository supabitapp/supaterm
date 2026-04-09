import Foundation
import FuzzyMatch
import SwiftUI

struct TerminalCommandPaletteState: Equatable {
  var query = ""
  var selectedRowID: TerminalCommandPaletteRow.ID?
  var customRows: [TerminalCommandPaletteRow] = []
  var problems: [TerminalCustomCommandProblem] = []
  var isLoading = false
}

enum TerminalCommandPaletteCommand: Equatable, Sendable {
  case customCommand(TerminalCustomCommandSnapshot)
  case ghosttyBindingAction(String)
  case toggleSidebar
  case createSpace
  case renameSpace(TerminalSpaceItem)
  case selectSpace(TerminalSpaceID)
  case selectTab(TerminalTabID)
}

struct TerminalCommandPaletteRow: Equatable, Identifiable, Sendable {
  let id: String
  let symbol: String
  let title: String
  let subtitle: String
  let shortcut: String?
  let keywords: [String]
  let command: TerminalCommandPaletteCommand

  var searchableText: String {
    ([title, subtitle] + keywords).joined(separator: " ")
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
    rows(from: snapshot, customRows: [])
  }

  static func rows(
    from snapshot: TerminalCommandPaletteSnapshot,
    customRows: [TerminalCommandPaletteRow]
  ) -> [TerminalCommandPaletteRow] {
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
      contentsOf: customRows.filter { row in
        switch row.command {
        case .customCommand(let command):
          return snapshot.hasFocusedSurface || !command.requiresFocusedSurface
        default:
          return true
        }
      }
    )

    rows.append(
      .init(
        id: "supaterm:toggle-sidebar",
        symbol: "sidebar.leading",
        title: "Toggle Sidebar",
        subtitle: "View",
        shortcut: toggleSidebarShortcut,
        keywords: [],
        command: .toggleSidebar
      )
    )
    rows.append(
      .init(
        id: "supaterm:create-space",
        symbol: "plus.square.on.square",
        title: "Create Space",
        subtitle: "Spaces",
        shortcut: nil,
        keywords: [],
        command: .createSpace
      )
    )

    if let selectedSpace = snapshot.selectedSpaceID.flatMap({ selectedSpaceID in
      snapshot.spaces.first(where: { $0.id == selectedSpaceID })
    }) {
      rows.append(
        .init(
          id: "supaterm:rename-space:\(selectedSpace.id.rawValue.uuidString)",
          symbol: "square.and.pencil",
          title: "Rename Space",
          subtitle: selectedSpace.name,
          shortcut: nil,
          keywords: [],
          command: .renameSpace(selectedSpace)
        )
      )
    }

    rows.append(
      contentsOf: snapshot.spaces.compactMap { space in
        guard space.id != snapshot.selectedSpaceID else { return nil }
        return .init(
          id: "supaterm:space:\(space.id.rawValue.uuidString)",
          symbol: "square.stack.3d.up",
          title: "Switch to \(space.name)",
          subtitle: "Space",
          shortcut: nil,
          keywords: [],
          command: .selectSpace(space.id)
        )
      })

    rows.append(
      contentsOf: snapshot.visibleTabs.compactMap { tab in
        guard tab.id != snapshot.selectedTabID else { return nil }
        return .init(
          id: "supaterm:tab:\(tab.id.rawValue.uuidString)",
          symbol: tab.symbol,
          title: "Switch to \(tab.title)",
          subtitle: "Tab",
          shortcut: nil,
          keywords: [],
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
    _ command: TerminalCustomCommandSnapshot
  ) -> TerminalCommandPaletteRow {
    .init(
      id: "custom:\(command.id)",
      symbol: symbol(for: command),
      title: command.title,
      subtitle: command.subtitle,
      shortcut: nil,
      keywords: command.keywords,
      command: .customCommand(command)
    )
  }

  static func customRows(
    from commands: [TerminalCustomCommandSnapshot]
  ) -> [TerminalCommandPaletteRow] {
    commands.map(ghosttyRow)
  }

  private static func ghosttyRow(
    _ command: GhosttyCommand,
    shortcut: String?
  ) -> TerminalCommandPaletteRow {
    .init(
      id: "ghostty:\(command.action)",
      symbol: symbol(for: command),
      title: command.title,
      subtitle: command.description.isEmpty ? "Terminal" : command.description,
      shortcut: shortcut,
      keywords: [],
      command: .ghosttyBindingAction(command.action)
    )
  }

  private static func symbol(for command: GhosttyCommand) -> String {
    switch command.action {
    case "new_split:right":
      return "rectangle.righthalf.inset.filled"
    case "new_split:left":
      return "rectangle.lefthalf.inset.filled"
    case "new_split:down":
      return "rectangle.bottomhalf.inset.filled"
    case "new_split:up":
      return "rectangle.tophalf.inset.filled"
    default:
      break
    }

    switch command.actionKey {
    case "close_surface", "close_tab", "close_window":
      return "xmark"
    case "copy_to_clipboard":
      return "doc.on.doc"
    case "equalize_splits":
      return "inset.filled.topleft.topright.bottomleft.bottomright.rectangle"
    case "new_tab":
      return "plus"
    case "open_config":
      return "gearshape"
    case "paste_from_clipboard", "paste_from_selection":
      return "doc.on.clipboard"
    case "prompt_surface_title", "prompt_tab_title":
      return "pencil.line"
    case "search_selection", "start_search":
      return "magnifyingglass"
    case "toggle_split_zoom":
      return "arrow.up.left.and.arrow.down.right"
    default:
      return "terminal"
    }
  }

  private static func symbol(for command: TerminalCustomCommandSnapshot) -> String {
    switch command.kind {
    case .command:
      return "terminal"
    case .workspace:
      return "square.3.layers.3d.top.filled"
    }
  }
}

private struct ScoredRow {
  let index: Int
  let row: TerminalCommandPaletteRow
  let score: Double
}
