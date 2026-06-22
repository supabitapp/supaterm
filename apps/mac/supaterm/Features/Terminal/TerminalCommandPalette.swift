import Foundation
import SupatermTerminalModels
import SupatermUpdateFeature
import SwiftUI

public struct TerminalCommandPaletteState: Equatable {
  public var query = ""
  public var selectedRowID: TerminalCommandPaletteRow.ID?

  public init(query: String = "", selectedRowID: TerminalCommandPaletteRow.ID? = nil) {
    self.query = query
    self.selectedRowID = selectedRowID
  }
}

public struct TerminalCommandPaletteFocusTarget: Equatable, Sendable {
  public let windowControllerID: UUID
  public let surfaceID: UUID
  public let title: String
  public let subtitle: String?

  public init(windowControllerID: UUID, surfaceID: UUID, title: String, subtitle: String?) {
    self.windowControllerID = windowControllerID
    self.surfaceID = surfaceID
    self.title = title
    self.subtitle = subtitle
  }
}

public struct TerminalCommandPaletteUpdateEntry: Equatable, Sendable {
  public let id: String
  public let title: String
  public let subtitle: String?
  public let description: String?
  public let leadingIcon: String?
  public let badge: String?
  public let emphasis: Bool
  public let action: UpdateUserAction

  public init(
    id: String,
    title: String,
    subtitle: String?,
    description: String?,
    leadingIcon: String?,
    badge: String?,
    emphasis: Bool,
    action: UpdateUserAction
  ) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.description = description
    self.leadingIcon = leadingIcon
    self.badge = badge
    self.emphasis = emphasis
    self.action = action
  }
}

public enum TerminalCommandPaletteCommand: Equatable, Sendable {
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

public struct TerminalCommandPaletteRow: Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let subtitle: String?
  public let description: String?
  public let leadingIcon: String?
  public let badge: String?
  public let emphasis: Bool
  public let shortcut: String?
  public let command: TerminalCommandPaletteCommand

  public init(
    id: String,
    title: String,
    subtitle: String?,
    description: String?,
    leadingIcon: String?,
    badge: String?,
    emphasis: Bool,
    shortcut: String?,
    command: TerminalCommandPaletteCommand
  ) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.description = description
    self.leadingIcon = leadingIcon
    self.badge = badge
    self.emphasis = emphasis
    self.shortcut = shortcut
    self.command = command
  }

  public var searchableText: String {
    [title, subtitle]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")
  }
}

public struct TerminalCommandPaletteSnapshot: Equatable, Sendable {
  public let ghosttyCommands: [GhosttyCommand]
  public let ghosttyShortcutDisplayByAction: [String: String]
  public let hasFocusedSurface: Bool
  public let updateEntries: [TerminalCommandPaletteUpdateEntry]
  public let focusTargets: [TerminalCommandPaletteFocusTarget]
  public let selectedSpaceID: TerminalSpaceID?
  public let spaces: [TerminalSpaceItem]
  public let selectedTabID: TerminalTabID?
  public let visibleTabs: [TerminalTabItem]

  public init(
    ghosttyCommands: [GhosttyCommand],
    ghosttyShortcutDisplayByAction: [String: String],
    hasFocusedSurface: Bool,
    updateEntries: [TerminalCommandPaletteUpdateEntry],
    focusTargets: [TerminalCommandPaletteFocusTarget],
    selectedSpaceID: TerminalSpaceID?,
    spaces: [TerminalSpaceItem],
    selectedTabID: TerminalTabID?,
    visibleTabs: [TerminalTabItem]
  ) {
    self.ghosttyCommands = ghosttyCommands
    self.ghosttyShortcutDisplayByAction = ghosttyShortcutDisplayByAction
    self.hasFocusedSurface = hasFocusedSurface
    self.updateEntries = updateEntries
    self.focusTargets = focusTargets
    self.selectedSpaceID = selectedSpaceID
    self.spaces = spaces
    self.selectedTabID = selectedTabID
    self.visibleTabs = visibleTabs
  }

  public var selectedSpace: TerminalSpaceItem? {
    guard let selectedSpaceID else { return nil }
    return spaces.first { $0.id == selectedSpaceID }
  }

  public var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return visibleTabs.first { $0.id == selectedTabID }
  }

  public static let empty = Self(
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
    var rows = sortRows(contextRows(from: snapshot))
    rows.append(contentsOf: snapshot.updateEntries.map(updateRow))
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
    let matchedRows: [MatchedRow] = rows.enumerated().compactMap { index, row -> MatchedRow? in
      guard row.searchableText.lowercased().contains(normalizedQuery) else {
        return nil
      }
      return MatchedRow(index: index, row: row)
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
    [
      TerminalCommandPaletteRow(
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

    return TerminalCommandPaletteRow(
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
