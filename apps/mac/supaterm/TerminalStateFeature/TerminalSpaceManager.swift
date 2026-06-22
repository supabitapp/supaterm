import Foundation
import Observation
import SupatermTerminalModels

@MainActor
@Observable
public final class TerminalSpaceManager {
  public struct SpaceCatalogDiff: Equatable {
    public let removedTabIDs: [TerminalTabID]
  }

  public private(set) var spaces: [TerminalSpaceItem] = []
  private var tabManagers: [TerminalSpaceID: TerminalTabManager] = [:]
  public var selectedSpaceID: TerminalSpaceID?

  public init() {}

  public var activeTabManager: TerminalTabManager? {
    guard let selectedSpaceID else { return nil }
    return tabManagers[selectedSpaceID]
  }

  public var tabs: [TerminalTabItem] {
    activeTabManager?.tabs ?? []
  }

  public var pinnedTabs: [TerminalTabItem] {
    activeTabManager?.pinnedTabs ?? []
  }

  public var regularTabs: [TerminalTabItem] {
    activeTabManager?.regularTabs ?? []
  }

  public var visibleTabs: [TerminalTabItem] {
    activeTabManager?.visibleTabs ?? []
  }

  public var selectedTabID: TerminalTabID? {
    activeTabManager?.selectedTabId
  }

  public func bootstrap(
    from catalog: TerminalSpaceCatalog,
    initialSelectedSpaceID: TerminalSpaceID?
  ) {
    spaces.removeAll()
    tabManagers.removeAll()
    selectedSpaceID = nil

    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    for space in resolvedCatalog.spaces {
      let item = TerminalSpaceItem(id: space.id, name: space.name)
      spaces.append(item)
      tabManagers[item.id] = TerminalTabManager()
    }
    selectedSpaceID =
      initialSelectedSpaceID.flatMap { spaceID in
        spaces.contains(where: { $0.id == spaceID }) ? spaceID : nil
      }
      ?? resolvedCatalog.defaultSelectedSpaceID
  }

  public func selectSpace(_ id: TerminalSpaceID) -> Bool {
    guard spaces.contains(where: { $0.id == id }) else { return false }
    selectedSpaceID = id
    return true
  }

  public func applyCatalog(_ catalog: TerminalSpaceCatalog) -> SpaceCatalogDiff {
    let resolvedCatalog = Self.sanitizedCatalog(catalog)
    let previousSpaces = spaces
    let previousTabManagers = tabManagers
    let previousSelectedSpaceID = selectedSpaceID

    let nextSpaces = resolvedCatalog.spaces.map {
      TerminalSpaceItem(id: $0.id, name: $0.name)
    }
    var nextTabManagers: [TerminalSpaceID: TerminalTabManager] = [:]
    for space in nextSpaces {
      nextTabManagers[space.id] = previousTabManagers[space.id] ?? TerminalTabManager()
    }

    let removedSpaceIDs = Set(previousTabManagers.keys).subtracting(nextTabManagers.keys)
    let removedTabIDs =
      previousSpaces
      .filter { removedSpaceIDs.contains($0.id) }
      .flatMap { previousTabManagers[$0.id]?.tabs.map(\.id) ?? [] }

    spaces = nextSpaces
    tabManagers = nextTabManagers
    selectedSpaceID = resolvedSelectedSpaceID(
      current: previousSelectedSpaceID,
      previousSpaces: previousSpaces,
      resolvedCatalog: resolvedCatalog
    )

    return SpaceCatalogDiff(removedTabIDs: removedTabIDs)
  }

  public func isNameAvailable(
    _ proposedName: String,
    excluding excludedID: TerminalSpaceID? = nil
  ) -> Bool {
    guard let normalizedName = normalizedName(proposedName) else { return false }
    return !spaces.contains {
      $0.id != excludedID && $0.name.localizedCaseInsensitiveCompare(normalizedName) == .orderedSame
    }
  }

  public func tabManager(for spaceID: TerminalSpaceID) -> TerminalTabManager? {
    tabManagers[spaceID]
  }

  public func space(for tabID: TerminalTabID) -> TerminalSpaceItem? {
    spaces.first { space in
      tabManagers[space.id]?.tabs.contains(where: { $0.id == tabID }) == true
    }
  }

  public func tabs(in spaceID: TerminalSpaceID) -> [TerminalTabItem] {
    tabManagers[spaceID]?.tabs ?? []
  }

  public func space(at index: Int) -> TerminalSpaceItem? {
    let offset = index - 1
    guard spaces.indices.contains(offset) else { return nil }
    return spaces[offset]
  }

  public func selectedTabID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    tabManagers[spaceID]?.selectedTabId
  }

  public func spaceIndex(for spaceID: TerminalSpaceID) -> Int? {
    spaces.firstIndex(where: { $0.id == spaceID }).map { $0 + 1 }
  }

  public func tab(for tabID: TerminalTabID) -> TerminalTabItem? {
    for space in spaces {
      if let tab = tabManagers[space.id]?.tabs.first(where: { $0.id == tabID }) {
        return tab
      }
    }
    return nil
  }

  @discardableResult
  public func restoreTabs(
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
