import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceManager {
  struct SpaceCatalogDiff: Equatable {
    let removedTabIDs: [TerminalTabID]
  }

  private(set) var spaces: [TerminalSpaceItem] = []
  private var projectManagers: [TerminalSpaceID: TerminalProjectManager] = [:]
  var selectedSpaceID: TerminalSpaceID?

  var activeProjectManager: TerminalProjectManager? {
    guard let selectedSpaceID else { return nil }
    return projectManagers[selectedSpaceID]
  }

  var projects: [TerminalProjectItem] {
    activeProjectManager?.projects ?? []
  }

  var projectGroups: [TerminalProjectTabs] {
    activeProjectManager?.groups ?? []
  }

  var tabs: [TerminalTabItem] {
    activeProjectManager?.tabs ?? []
  }

  var regularTabs: [TerminalTabItem] {
    activeProjectManager?.regularTabs ?? []
  }

  var visibleTabs: [TerminalTabItem] {
    activeProjectManager?.visibleTabs ?? []
  }

  var selectedTabID: TerminalTabID? {
    activeProjectManager?.selectedTabId
  }

  func bootstrap(
    from catalog: TerminalSpaceCatalog,
    initialSelectedSpaceID: TerminalSpaceID?
  ) {
    spaces.removeAll()
    projectManagers.removeAll()
    selectedSpaceID = nil

    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    for space in resolvedCatalog.spaces {
      let item = TerminalSpaceItem(id: space.id, name: space.name)
      spaces.append(item)
      projectManagers[item.id] = TerminalProjectManager(projects: space.projects)
    }
    selectedSpaceID =
      initialSelectedSpaceID.flatMap { spaceID in
        spaces.contains(where: { $0.id == spaceID }) ? spaceID : nil
      }
      ?? resolvedCatalog.defaultSelectedSpaceID
  }

  func selectSpace(_ id: TerminalSpaceID) -> Bool {
    guard spaces.contains(where: { $0.id == id }) else { return false }
    selectedSpaceID = id
    return true
  }

  func applyCatalog(_ catalog: TerminalSpaceCatalog) -> SpaceCatalogDiff {
    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    let previousSpaces = spaces
    let previousProjectManagers = projectManagers
    let previousSelectedSpaceID = selectedSpaceID

    let nextSpaces = resolvedCatalog.spaces.map {
      TerminalSpaceItem(id: $0.id, name: $0.name)
    }
    var nextProjectManagers: [TerminalSpaceID: TerminalProjectManager] = [:]
    var removedTabIDs: [TerminalTabID] = []
    for space in resolvedCatalog.spaces {
      let manager = previousProjectManagers[space.id] ?? TerminalProjectManager()
      removedTabIDs.append(contentsOf: manager.applyProjects(space.projects))
      nextProjectManagers[space.id] = manager
    }

    let removedSpaceIDs = Set(previousProjectManagers.keys).subtracting(nextProjectManagers.keys)
    removedTabIDs.append(
      contentsOf:
        previousSpaces
        .filter { removedSpaceIDs.contains($0.id) }
        .flatMap { previousProjectManagers[$0.id]?.tabs.map(\.id) ?? [] }
    )

    spaces = nextSpaces
    projectManagers = nextProjectManagers
    selectedSpaceID = resolvedSelectedSpaceID(
      current: previousSelectedSpaceID,
      previousSpaces: previousSpaces,
      resolvedCatalog: resolvedCatalog
    )

    return SpaceCatalogDiff(removedTabIDs: removedTabIDs)
  }

  func isNameAvailable(
    _ proposedName: String,
    excluding excludedID: TerminalSpaceID? = nil
  ) -> Bool {
    guard let normalizedName = normalizedName(proposedName) else { return false }
    return !spaces.contains {
      $0.id != excludedID && $0.name.localizedCaseInsensitiveCompare(normalizedName) == .orderedSame
    }
  }

  func projectManager(for spaceID: TerminalSpaceID) -> TerminalProjectManager? {
    projectManagers[spaceID]
  }

  func space(for tabID: TerminalTabID) -> TerminalSpaceItem? {
    spaces.first { space in
      projectManagers[space.id]?.tab(for: tabID) != nil
    }
  }

  func space(for projectID: TerminalProjectID) -> TerminalSpaceItem? {
    spaces.first { space in
      projectManagers[space.id]?.projects.contains(where: { $0.id == projectID }) == true
    }
  }

  func project(for tabID: TerminalTabID) -> TerminalProjectItem? {
    for space in spaces {
      if let project = projectManagers[space.id]?.project(for: tabID) {
        return project
      }
    }
    return nil
  }

  func projects(in spaceID: TerminalSpaceID) -> [TerminalProjectItem] {
    projectManagers[spaceID]?.projects ?? []
  }

  func projectGroups(in spaceID: TerminalSpaceID) -> [TerminalProjectTabs] {
    projectManagers[spaceID]?.groups ?? []
  }

  func tabs(in spaceID: TerminalSpaceID) -> [TerminalTabItem] {
    projectManagers[spaceID]?.tabs ?? []
  }

  func tabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    guard let space = space(for: projectID) else { return [] }
    return projectManagers[space.id]?.tabs(in: projectID) ?? []
  }

  func space(at index: Int) -> TerminalSpaceItem? {
    let offset = index - 1
    guard spaces.indices.contains(offset) else { return nil }
    return spaces[offset]
  }

  func project(at index: Int, in spaceID: TerminalSpaceID) -> TerminalProjectItem? {
    projectManagers[spaceID]?.project(at: index)
  }

  func selectedTabID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    projectManagers[spaceID]?.selectedTabId
  }

  func spaceIndex(for spaceID: TerminalSpaceID) -> Int? {
    spaces.firstIndex(where: { $0.id == spaceID }).map { $0 + 1 }
  }

  func projectIndex(for projectID: TerminalProjectID, in spaceID: TerminalSpaceID) -> Int? {
    projectManagers[spaceID]?.projectIndex(for: projectID)
  }

  func tab(for tabID: TerminalTabID) -> TerminalTabItem? {
    for space in spaces {
      if let tab = projectManagers[space.id]?.tab(for: tabID) {
        return tab
      }
    }
    return nil
  }

  func projectID(for tabID: TerminalTabID) -> TerminalProjectID? {
    for space in spaces {
      if let projectID = projectManagers[space.id]?.projectID(for: tabID) {
        return projectID
      }
    }
    return nil
  }

  @discardableResult
  func restoreTabs(
    _ groups: [TerminalProjectTabs],
    selectedTabID: TerminalTabID?,
    in spaceID: TerminalSpaceID
  ) -> Bool {
    guard let projectManager = projectManagers[spaceID] else { return false }
    projectManager.restoreTabs(groups, selectedTabID: selectedTabID)
    return true
  }

  private func normalizedName(_ name: String) -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func resolvedSelectedSpaceID(
    current currentSelectedSpaceID: TerminalSpaceID?,
    previousSpaces: [TerminalSpaceItem],
    resolvedCatalog: TerminalSpaceCatalog
  ) -> TerminalSpaceID {
    if let currentSelectedSpaceID,
      spaces.contains(where: { $0.id == currentSelectedSpaceID })
    {
      return currentSelectedSpaceID
    }

    if let currentSelectedSpaceID,
      let currentIndex = previousSpaces.firstIndex(where: { $0.id == currentSelectedSpaceID })
    {
      for space in previousSpaces[..<currentIndex].reversed()
      where spaces.contains(where: { $0.id == space.id }) {
        return space.id
      }
    }

    if spaces.contains(where: { $0.id == resolvedCatalog.defaultSelectedSpaceID }) {
      return resolvedCatalog.defaultSelectedSpaceID
    }

    return spaces[0].id
  }

  private static func sanitizedCatalog(
    _ catalog: TerminalSpaceCatalog
  ) -> TerminalSpaceCatalog {
    TerminalSpaceCatalog.sanitized(catalog)
  }
}
