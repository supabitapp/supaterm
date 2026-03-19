import Foundation
import Observation

@MainActor
@Observable
final class TerminalWorkspaceManager {
  struct DeletedWorkspaceResult: Equatable {
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

  func restore(from snapshot: TerminalWorkspaceSnapshot?) {
    workspaces.removeAll()
    tabManagers.removeAll()
    selectedWorkspaceID = nil

    let resolvedSnapshot = snapshot.flatMap(Self.sanitizedSnapshot(_:)) ?? Self.defaultSnapshot
    for workspace in resolvedSnapshot.workspaces {
      let item = TerminalWorkspaceItem(id: workspace.id, name: workspace.name)
      workspaces.append(item)
      tabManagers[item.id] = TerminalTabManager()
    }
    selectedWorkspaceID = resolvedSnapshot.selectedWorkspaceID
  }

  func snapshot() -> TerminalWorkspaceSnapshot {
    let resolvedSelectedWorkspaceID = selectedWorkspaceID ?? workspaces[0].id
    return TerminalWorkspaceSnapshot(
      selectedWorkspaceID: resolvedSelectedWorkspaceID,
      workspaces: workspaces.map {
        PersistedTerminalWorkspace(id: $0.id, name: $0.name)
      }
    )
  }

  func selectWorkspace(_ id: TerminalWorkspaceID) -> Bool {
    guard workspaces.contains(where: { $0.id == id }) else { return false }
    selectedWorkspaceID = id
    return true
  }

  @discardableResult
  func createWorkspace() -> TerminalWorkspaceItem {
    let workspace = TerminalWorkspaceItem(name: nextDefaultWorkspaceName())
    workspaces.append(workspace)
    tabManagers[workspace.id] = TerminalTabManager()
    selectedWorkspaceID = workspace.id
    return workspace
  }

  func renameWorkspace(_ id: TerminalWorkspaceID, to proposedName: String) -> Bool {
    guard let normalizedName = normalizedName(proposedName) else { return false }
    guard isNameAvailable(normalizedName, excluding: id) else { return false }
    guard let index = workspaces.firstIndex(where: { $0.id == id }) else { return false }
    workspaces[index].name = normalizedName
    return true
  }

  func deleteWorkspace(_ id: TerminalWorkspaceID) -> DeletedWorkspaceResult? {
    guard workspaces.count > 1 else { return nil }
    guard let index = workspaces.firstIndex(where: { $0.id == id }) else { return nil }

    let removedWorkspace = workspaces.remove(at: index)
    let removedTabIDs = tabManagers[removedWorkspace.id]?.tabs.map(\.id) ?? []
    tabManagers.removeValue(forKey: removedWorkspace.id)

    if selectedWorkspaceID == removedWorkspace.id {
      let nextIndex = max(0, index - 1)
      selectedWorkspaceID = workspaces[nextIndex].id
    }

    return DeletedWorkspaceResult(removedTabIDs: removedTabIDs)
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

  private static func sanitizedSnapshot(
    _ snapshot: TerminalWorkspaceSnapshot
  ) -> TerminalWorkspaceSnapshot? {
    let workspaces = snapshot.workspaces.compactMap { workspace -> PersistedTerminalWorkspace? in
      let trimmedName = workspace.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }
      return PersistedTerminalWorkspace(id: workspace.id, name: trimmedName)
    }
    guard !workspaces.isEmpty else { return nil }
    guard workspaces.contains(where: { $0.id == snapshot.selectedWorkspaceID }) else {
      return TerminalWorkspaceSnapshot(
        selectedWorkspaceID: workspaces[0].id,
        workspaces: workspaces
      )
    }
    return TerminalWorkspaceSnapshot(
      selectedWorkspaceID: snapshot.selectedWorkspaceID,
      workspaces: workspaces
    )
  }

  private static var defaultSnapshot: TerminalWorkspaceSnapshot {
    let workspace = PersistedTerminalWorkspace(
      id: TerminalWorkspaceID(),
      name: "A"
    )
    return TerminalWorkspaceSnapshot(
      selectedWorkspaceID: workspace.id,
      workspaces: [workspace]
    )
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
