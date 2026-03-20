import Foundation
import Observation

@MainActor
@Observable
final class TerminalWorkspaceManager {
  struct WorkspaceCatalogDiff: Equatable {
    let removedTabIDs: [TerminalTabID]
  }

  private(set) var workspaces: [TerminalWorkspaceItem] = []
  private var tabManagers: [TerminalWorkspaceID: TerminalTabManager] = [:]
  var selectedWorkspaceID: TerminalWorkspaceID?

  var activeTabManager: TerminalTabManager? {
    guard let selectedWorkspaceID else { return nil }
    return tabManagers[selectedWorkspaceID]
  }

  var tabs: [TerminalTabItem] {
    activeTabManager?.tabs ?? []
  }

  var pinnedTabs: [TerminalTabItem] {
    activeTabManager?.pinnedTabs ?? []
  }

  var regularTabs: [TerminalTabItem] {
    activeTabManager?.regularTabs ?? []
  }

  var visibleTabs: [TerminalTabItem] {
    activeTabManager?.visibleTabs ?? []
  }

  var selectedTabID: TerminalTabID? {
    activeTabManager?.selectedTabId
  }

  var hasSelectedWorkspace: Bool {
    selectedWorkspaceID != nil
  }

  func bootstrap(
    from catalog: TerminalWorkspaceCatalog,
    initialSelectedWorkspaceID: TerminalWorkspaceID?
  ) {
    workspaces.removeAll()
    tabManagers.removeAll()
    selectedWorkspaceID = nil

    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    for workspace in resolvedCatalog.workspaces {
      let item = TerminalWorkspaceItem(id: workspace.id, name: workspace.name)
      workspaces.append(item)
      tabManagers[item.id] = TerminalTabManager()
    }
    selectedWorkspaceID =
      initialSelectedWorkspaceID.flatMap { workspaceID in
        workspaces.contains(where: { $0.id == workspaceID }) ? workspaceID : nil
      }
      ?? resolvedCatalog.defaultSelectedWorkspaceID
  }

  func selectWorkspace(_ id: TerminalWorkspaceID) -> Bool {
    guard workspaces.contains(where: { $0.id == id }) else { return false }
    selectedWorkspaceID = id
    return true
  }

  func applyCatalog(_ catalog: TerminalWorkspaceCatalog) -> WorkspaceCatalogDiff {
    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    let previousWorkspaces = workspaces
    let previousTabManagers = tabManagers
    let previousSelectedWorkspaceID = selectedWorkspaceID

    let nextWorkspaces = resolvedCatalog.workspaces.map {
      TerminalWorkspaceItem(id: $0.id, name: $0.name)
    }
    var nextTabManagers: [TerminalWorkspaceID: TerminalTabManager] = [:]
    for workspace in nextWorkspaces {
      nextTabManagers[workspace.id] = previousTabManagers[workspace.id] ?? TerminalTabManager()
    }

    let removedWorkspaceIDs = Set(previousTabManagers.keys).subtracting(nextTabManagers.keys)
    let removedTabIDs =
      previousWorkspaces
      .filter { removedWorkspaceIDs.contains($0.id) }
      .flatMap { previousTabManagers[$0.id]?.tabs.map(\.id) ?? [] }

    workspaces = nextWorkspaces
    tabManagers = nextTabManagers
    selectedWorkspaceID = resolvedSelectedWorkspaceID(
      current: previousSelectedWorkspaceID,
      previousWorkspaces: previousWorkspaces,
      resolvedCatalog: resolvedCatalog
    )

    return WorkspaceCatalogDiff(removedTabIDs: removedTabIDs)
  }

  func isNameAvailable(
    _ proposedName: String,
    excluding excludedID: TerminalWorkspaceID? = nil
  ) -> Bool {
    guard let normalizedName = normalizedName(proposedName) else { return false }
    return !workspaces.contains {
      $0.id != excludedID && $0.name.localizedCaseInsensitiveCompare(normalizedName) == .orderedSame
    }
  }

  func tabManager(for workspaceID: TerminalWorkspaceID) -> TerminalTabManager? {
    tabManagers[workspaceID]
  }

  func workspace(for tabID: TerminalTabID) -> TerminalWorkspaceItem? {
    workspaces.first { workspace in
      tabManagers[workspace.id]?.tabs.contains(where: { $0.id == tabID }) == true
    }
  }

  func tabs(in workspaceID: TerminalWorkspaceID) -> [TerminalTabItem] {
    tabManagers[workspaceID]?.tabs ?? []
  }

  func selectedTabID(in workspaceID: TerminalWorkspaceID) -> TerminalTabID? {
    tabManagers[workspaceID]?.selectedTabId
  }

  func workspaceIndex(for workspaceID: TerminalWorkspaceID) -> Int? {
    workspaces.firstIndex(where: { $0.id == workspaceID }).map { $0 + 1 }
  }

  func tab(for tabID: TerminalTabID) -> TerminalTabItem? {
    for workspace in workspaces {
      if let tab = tabManagers[workspace.id]?.tabs.first(where: { $0.id == tabID }) {
        return tab
      }
    }
    return nil
  }

  func nextDefaultWorkspaceName() -> String {
    let existingNames = Set(workspaces.map { $0.name.lowercased() })
    var index = 0
    while true {
      let candidate = Self.spreadsheetLabel(for: index)
      if !existingNames.contains(candidate.lowercased()) {
        return candidate
      }
      index += 1
    }
  }

  private func normalizedName(_ name: String) -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func resolvedSelectedWorkspaceID(
    current currentSelectedWorkspaceID: TerminalWorkspaceID?,
    previousWorkspaces: [TerminalWorkspaceItem],
    resolvedCatalog: TerminalWorkspaceCatalog
  ) -> TerminalWorkspaceID {
    if let currentSelectedWorkspaceID,
      workspaces.contains(where: { $0.id == currentSelectedWorkspaceID })
    {
      return currentSelectedWorkspaceID
    }

    if let currentSelectedWorkspaceID,
      let currentIndex = previousWorkspaces.firstIndex(where: { $0.id == currentSelectedWorkspaceID })
    {
      for workspace in previousWorkspaces[..<currentIndex].reversed()
      where workspaces.contains(where: { $0.id == workspace.id }) {
        return workspace.id
      }
    }

    if workspaces.contains(where: { $0.id == resolvedCatalog.defaultSelectedWorkspaceID }) {
      return resolvedCatalog.defaultSelectedWorkspaceID
    }

    return workspaces[0].id
  }

  private static func sanitizedCatalog(
    _ catalog: TerminalWorkspaceCatalog
  ) -> TerminalWorkspaceCatalog {
    TerminalWorkspaceCatalog.sanitized(catalog)
  }

  private static func spreadsheetLabel(for index: Int) -> String {
    precondition(index >= 0)

    var value = index + 1
    var label = ""

    while value > 0 {
      let remainder = (value - 1) % 26
      let scalar = UnicodeScalar(65 + remainder)!
      label.insert(Character(scalar), at: label.startIndex)
      value = (value - 1) / 26
    }

    return label
  }
}
