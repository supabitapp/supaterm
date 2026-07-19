import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceManager {
  struct SpaceCatalogDiff: Equatable {
    let removedTabIDs: [TerminalTabID]
  }

  private(set) var spaces: [TerminalSpaceItem] = []
  private var tabManagers: [TerminalSpaceID: TerminalTabManager] = [:]
  var selectedSpaceID: TerminalSpaceID?

  var activeTabManager: TerminalTabManager? {
    guard let selectedSpaceID else { return nil }
    return tabManagers[selectedSpaceID]
  }

  var selectedTabID: TerminalTabID? {
    activeTabManager?.selectedTabId
  }

  func bootstrap(
    from catalog: TerminalSpaceCatalog,
    initialSelectedSpaceID: TerminalSpaceID?
  ) {
    spaces.removeAll()
    tabManagers.removeAll()
    selectedSpaceID = nil

    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    for space in resolvedCatalog.spaces {
      let item = TerminalSpaceItem(
        id: space.id,
        name: space.name,
        projects: space.projects
      )
      spaces.append(item)
      tabManagers[item.id] = TerminalTabManager(projectIDs: item.projects.map(\.id))
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
    let previousTabManagers = tabManagers
    let previousSelectedSpaceID = selectedSpaceID

    let nextSpaces = resolvedCatalog.spaces.map {
      TerminalSpaceItem(id: $0.id, name: $0.name, projects: $0.projects)
    }
    var nextTabManagers: [TerminalSpaceID: TerminalTabManager] = [:]
    var removedTabIDs: [TerminalTabID] = []
    for space in nextSpaces {
      if let manager = previousTabManagers[space.id] {
        removedTabIDs.append(contentsOf: manager.updateProjectOrder(space.projects.map(\.id)))
        nextTabManagers[space.id] = manager
      } else {
        nextTabManagers[space.id] = TerminalTabManager(projectIDs: space.projects.map(\.id))
      }
    }

    let removedSpaceIDs = Set(previousTabManagers.keys).subtracting(nextTabManagers.keys)
    removedTabIDs.append(
      contentsOf:
        previousSpaces
        .filter { removedSpaceIDs.contains($0.id) }
        .flatMap { previousTabManagers[$0.id]?.tabs.map(\.id) ?? [] }
    )

    spaces = nextSpaces
    tabManagers = nextTabManagers
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

  func tabManager(for spaceID: TerminalSpaceID) -> TerminalTabManager? {
    tabManagers[spaceID]
  }

  func space(for tabID: TerminalTabID) -> TerminalSpaceItem? {
    spaces.first { space in
      tabManagers[space.id]?.tabs.contains(where: { $0.id == tabID }) == true
    }
  }

  func tabs(in spaceID: TerminalSpaceID) -> [TerminalTabItem] {
    tabManagers[spaceID]?.tabs ?? []
  }

  func tabs(
    in projectID: TerminalProjectID,
    spaceID: TerminalSpaceID
  ) -> [TerminalTabItem] {
    tabManagers[spaceID]?.tabs(in: projectID) ?? []
  }

  func orderedProjects(in spaceID: TerminalSpaceID) -> [TerminalProjectItem] {
    spaces.first(where: { $0.id == spaceID })?.projects ?? []
  }

  func homeProjectID(in spaceID: TerminalSpaceID) -> TerminalProjectID? {
    orderedProjects(in: spaceID).first(where: \.isHome)?.id
  }

  func space(at index: Int) -> TerminalSpaceItem? {
    let offset = index - 1
    guard spaces.indices.contains(offset) else { return nil }
    return spaces[offset]
  }

  func selectedTabID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    tabManagers[spaceID]?.selectedTabId
  }

  func spaceIndex(for spaceID: TerminalSpaceID) -> Int? {
    spaces.firstIndex(where: { $0.id == spaceID }).map { $0 + 1 }
  }

  func tab(for tabID: TerminalTabID) -> TerminalTabItem? {
    for space in spaces {
      if let tab = tabManagers[space.id]?.tabs.first(where: { $0.id == tabID }) {
        return tab
      }
    }
    return nil
  }

  @discardableResult
  func restoreTabs(
    _ tabs: [TerminalTabItem],
    selectedTabID: TerminalTabID?,
    in spaceID: TerminalSpaceID
  ) -> Bool {
    guard let tabManager = tabManagers[spaceID] else { return false }
    tabManager.restoreTabs(tabs, selectedTabID: selectedTabID)
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
