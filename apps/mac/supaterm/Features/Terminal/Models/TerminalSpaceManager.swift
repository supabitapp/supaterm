import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceManager {
  private(set) var catalog: TerminalSpaceCatalog
  private(set) var displayedInstance: TerminalSpaceInstance
  private(set) var lastDisplayedSpaceID: TerminalSpaceID?
  private var instancesBySpaceID: [TerminalSpaceID: TerminalSpaceInstance]

  init(catalog: TerminalSpaceCatalog, displayedSpaceID: TerminalSpaceID) {
    let resolvedCatalog = TerminalSpaceCatalog.sanitized(catalog)
    let resolvedSpaceID =
      resolvedCatalog.spaces.contains(where: { $0.id == displayedSpaceID })
      ? displayedSpaceID
      : resolvedCatalog.defaultSelectedSpaceID
    let instance = TerminalSpaceInstance(spaceID: resolvedSpaceID)
    self.catalog = resolvedCatalog
    self.displayedInstance = instance
    self.instancesBySpaceID = [resolvedSpaceID: instance]
  }

  var spaces: [TerminalSpaceItem] {
    catalog.spaces
  }

  var displayedSpaceID: TerminalSpaceID {
    displayedInstance.spaceID
  }

  var displayedSpace: TerminalSpaceItem {
    space(for: displayedSpaceID) ?? spaces[0]
  }

  var tabCollection: TerminalTabCollection {
    displayedInstance.tabCollection
  }

  var tabs: [TerminalTabItem] {
    displayedInstance.tabs
  }

  var rootItems: [TerminalTabRootItem] {
    displayedInstance.tabCollection.rootItems
  }

  var visibleTabs: [TerminalTabItem] {
    displayedInstance.tabCollection.visibleTabs
  }

  var selectedTabID: TerminalTabID? {
    displayedInstance.selectedTabID
  }

  var instances: [TerminalSpaceInstance] {
    spaces.compactMap { instancesBySpaceID[$0.id] }
  }

  var allTabs: [TerminalTabItem] {
    instances.flatMap(\.tabs)
  }

  var pendingSurfaceIDs: Set<UUID> {
    instances.reduce(into: Set<UUID>()) { result, instance in
      result.formUnion(instance.pendingSession?.surfaceIDs ?? [])
    }
  }

  func pendingInstance(containingSurface surfaceID: UUID) -> TerminalSpaceInstance? {
    pendingInstance { $0.surfaceIDs.contains(surfaceID) }
  }

  func pendingTabID(containingSurface surfaceID: UUID) -> TerminalTabID? {
    instances.lazy.compactMap(\.pendingSession).lazy
      .flatMap(\.tabs)
      .first { $0.root.orderedSurfaceIDs.contains(surfaceID) }?.id
  }

  func pendingInstance(containingTab tabID: TerminalTabID) -> TerminalSpaceInstance? {
    pendingInstance { $0.tabs.contains { $0.id == tabID } }
  }

  func pendingInstance(containingGroup groupID: TerminalTabGroupID) -> TerminalSpaceInstance? {
    pendingInstance { $0.groups.contains { $0.id == groupID } }
  }

  private func pendingInstance(
    matching predicate: (TerminalSpaceSession) -> Bool
  ) -> TerminalSpaceInstance? {
    instances.first { $0.pendingSession.map(predicate) == true }
  }

  func registerColdInstance(_ session: TerminalSpaceSession) {
    guard
      spaces.contains(where: { $0.id == session.spaceID }),
      instancesBySpaceID[session.spaceID] == nil
    else {
      return
    }
    instancesBySpaceID[session.spaceID] = TerminalSpaceInstance(
      spaceID: session.spaceID,
      pendingSession: session
    )
  }

  @discardableResult
  func applyCatalog(_ catalog: TerminalSpaceCatalog) -> [TerminalSpaceInstance] {
    let resolvedCatalog = TerminalSpaceCatalog.sanitized(catalog)
    let survivingSpaceIDs = Set(resolvedCatalog.spaces.map(\.id))
    let replacementID = replacementSpaceID(in: resolvedCatalog)
    let discardedInstances = instances.filter { !survivingSpaceIDs.contains($0.spaceID) }

    self.catalog = resolvedCatalog
    for instance in discardedInstances {
      instancesBySpaceID.removeValue(forKey: instance.spaceID)
    }
    if let lastDisplayedSpaceID, !survivingSpaceIDs.contains(lastDisplayedSpaceID) {
      self.lastDisplayedSpaceID = nil
    }
    if let replacementID {
      displayedInstance = instance(warming: replacementID)
    }
    return discardedInstances
  }

  @discardableResult
  func display(_ spaceID: TerminalSpaceID) -> Bool {
    guard spaces.contains(where: { $0.id == spaceID }) else { return false }
    guard spaceID != displayedSpaceID else { return true }
    lastDisplayedSpaceID = displayedSpaceID
    displayedInstance = instance(warming: spaceID)
    return true
  }

  private func replacementSpaceID(in catalog: TerminalSpaceCatalog) -> TerminalSpaceID? {
    let survivingSpaceIDs = Set(catalog.spaces.map(\.id))
    guard !survivingSpaceIDs.contains(displayedSpaceID) else { return nil }
    guard let index = spaces.firstIndex(where: { $0.id == displayedSpaceID }) else {
      return catalog.defaultSelectedSpaceID
    }
    let precedingSpace = spaces[..<index].last { survivingSpaceIDs.contains($0.id) }
    let followingSpace = spaces[(index + 1)...].first { survivingSpaceIDs.contains($0.id) }
    return (precedingSpace ?? followingSpace)?.id ?? catalog.defaultSelectedSpaceID
  }

  func instance(warming spaceID: TerminalSpaceID) -> TerminalSpaceInstance {
    if let instance = instancesBySpaceID[spaceID] {
      return instance
    }
    let instance = TerminalSpaceInstance(spaceID: spaceID)
    instancesBySpaceID[spaceID] = instance
    return instance
  }

  func instance(for spaceID: TerminalSpaceID) -> TerminalSpaceInstance? {
    instancesBySpaceID[spaceID]
  }

  func instance(for tabID: TerminalTabID) -> TerminalSpaceInstance? {
    instancesBySpaceID.values.first { $0.tabCollection.tabs.contains { $0.id == tabID } }
  }

  func instance(for groupID: TerminalTabGroupID) -> TerminalSpaceInstance? {
    instancesBySpaceID.values.first { $0.tabCollection.group(for: groupID) != nil }
  }

  func tabCollection(for spaceID: TerminalSpaceID) -> TerminalTabCollection? {
    guard spaces.contains(where: { $0.id == spaceID }) else { return nil }
    return instance(warming: spaceID).tabCollection
  }

  func space(for spaceID: TerminalSpaceID) -> TerminalSpaceItem? {
    spaces.first { $0.id == spaceID }
  }

  func space(for tabID: TerminalTabID) -> TerminalSpaceItem? {
    instance(for: tabID).flatMap { space(for: $0.spaceID) }
  }

  func space(for groupID: TerminalTabGroupID) -> TerminalSpaceItem? {
    instance(for: groupID).flatMap { space(for: $0.spaceID) }
  }

  func tabs(in spaceID: TerminalSpaceID) -> [TerminalTabItem] {
    instance(for: spaceID)?.tabs ?? []
  }

  func rootItems(in spaceID: TerminalSpaceID) -> [TerminalTabRootItem] {
    instance(for: spaceID)?.tabCollection.rootItems ?? []
  }

  func selectedTabID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    instance(for: spaceID)?.selectedTabID
  }

  func spaceIndex(for spaceID: TerminalSpaceID) -> Int? {
    spaces.firstIndex { $0.id == spaceID }.map { $0 + 1 }
  }

  func tab(for tabID: TerminalTabID) -> TerminalTabItem? {
    instance(for: tabID)?.tabCollection.tabs.first { $0.id == tabID }
  }

  @discardableResult
  func restoreRootItems(
    _ rootItems: [TerminalTabRootItem],
    selectedTabID: TerminalTabID?,
    in spaceID: TerminalSpaceID
  ) -> Bool {
    guard let tabCollection = tabCollection(for: spaceID) else { return false }
    tabCollection.restoreRootItems(rootItems, selectedTabID: selectedTabID)
    return true
  }
}
