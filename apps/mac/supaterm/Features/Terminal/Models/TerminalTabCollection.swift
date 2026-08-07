import Foundation
import Observation
import SupaTheme

struct TerminalTabTopology: Equatable {
  var tabsByID: [TerminalTabID: TerminalTabItem] = [:]
  var groupsByID: [TerminalTabGroupID: TerminalTabGroup] = [:]
  var pinnedRootIDs: [TerminalTabRootItemID] = []
  var regularRootIDs: [TerminalTabRootItemID] = []
  var childIDsByGroupID: [TerminalTabGroupID: [TerminalTabID]] = [:]
  var revision: UInt64 = 0
}

struct TerminalTabSelection: Equatable {
  var primaryTabID: TerminalTabID?

  mutating func select(_ tabID: TerminalTabID?, validTabIDs: Set<TerminalTabID>) {
    primaryTabID = tabID.flatMap { validTabIDs.contains($0) ? $0 : nil }
  }

  mutating func repair(validTabIDs: [TerminalTabID]) {
    guard primaryTabID.map(validTabIDs.contains) != true else { return }
    primaryTabID = validTabIDs.first
  }
}

@MainActor
@Observable
final class TerminalTabCollection {
  struct TransferPlan {
    fileprivate let destinationTopology: TerminalTabTopology
    fileprivate let expectedDestinationRevision: UInt64
    fileprivate let expectedSourceRevision: UInt64
    fileprivate let sourceTopology: TerminalTabTopology
    let result: TerminalTabTransferResult
  }

  private struct AppliedMove {
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
  }

  private struct ExtractedItems {
    let childIDsByGroupID: [TerminalTabGroupID: [TerminalTabID]]
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
    let groupsByID: [TerminalTabGroupID: TerminalTabGroup]
    let tabIDs: [TerminalTabID]
    let tabsByID: [TerminalTabID: TerminalTabItem]
  }

  private struct MoveSource {
    let groupIDs: [TerminalTabGroupID]
  }

  private var topology = TerminalTabTopology()
  private(set) var selection = TerminalTabSelection()

  var selectedTabID: TerminalTabID? {
    selection.primaryTabID
  }

  var topologyRevision: UInt64 {
    topology.revision
  }

  var snapshot: TerminalTabCollectionSnapshot {
    TerminalTabCollectionSnapshot(
      rootItems: rootItems,
      selectedTabID: selectedTabID,
      topologyRevision: topologyRevision
    )
  }

  var rootItems: [TerminalTabRootItem] {
    (topology.pinnedRootIDs + topology.regularRootIDs).compactMap {
      rootItem(for: $0, in: topology)
    }
  }

  var tabs: [TerminalTabItem] {
    rootItems.flatMap(\.tabs)
  }

  var pinnedRootItems: [TerminalTabRootItem] {
    topology.pinnedRootIDs.compactMap { rootItem(for: $0, in: topology) }
  }

  var regularRootItems: [TerminalTabRootItem] {
    topology.regularRootIDs.compactMap { rootItem(for: $0, in: topology) }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    let placement = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: topology.regularRootIDs.count)
    )
    return createTab(title: title, isTitleLocked: isTitleLocked, at: placement)!
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false,
    at placement: TerminalTabPlacement
  ) -> TerminalTabID? {
    let tab = TerminalTabItem(title: title, isTitleLocked: isTitleLocked)
    var next = topology
    guard Self.insertTabID(tab.id, at: placement, in: &next) else { return nil }
    next.tabsByID[tab.id] = tab
    next.revision += 1
    topology = next
    selection.primaryTabID = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    selection.select(id, validTabIDs: Set(topology.tabsByID.keys))
  }

  func clearSelection() {
    selection.primaryTabID = nil
  }

  func updateTitle(_ id: TerminalTabID, title: String) {
    updateTab(id) { tab in
      guard !tab.isTitleLocked else { return }
      tab.title = title
    }
  }

  func setLockedTitle(_ id: TerminalTabID, title: String?) {
    updateTab(id) { tab in
      tab.isTitleLocked = title != nil
      if let title {
        tab.title = title
      }
    }
  }

  func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    updateTab(id) { tab in
      tab.isDirty = isDirty
    }
  }

  @discardableResult
  func createGroup(
    title: String,
    color: ThemeTint = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupCreationResult? {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty else { return nil }
    guard Set(tabIDs).count == tabIDs.count else { return nil }
    guard tabIDs.allSatisfy({ topology.tabsByID[$0] != nil }) else { return nil }

    let insertion = groupInsertion(containing: tabIDs, in: topology)
    guard tabIDs.isEmpty || insertion != nil else { return nil }
    let resolvedInsertion =
      insertion
      ?? TerminalRootPlacement(isPinned: false, index: topology.regularRootIDs.count)
    let groupID = TerminalTabGroupID()
    var next = topology
    next.groupsByID[groupID] = TerminalTabGroup(
      id: groupID,
      title: normalizedTitle,
      color: color,
      lifetime: tabIDs.isEmpty ? .durable : .automatic
    )
    next.childIDsByGroupID[groupID] = []
    guard Self.insertRootID(.group(groupID), at: resolvedInsertion, in: &next) else {
      return nil
    }
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
    if !tabIDs.isEmpty {
      let request = TerminalTabMoveRequest(
        expectedTopologyRevision: next.revision,
        itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
        destination: .group(groupID, index: 0)
      )
      guard let applied = try? Self.applyMove(request, to: &next) else { return nil }
      deletedEmptyGroupIDs = applied.deletedEmptyGroupIDs
    } else {
      deletedEmptyGroupIDs = []
    }
    next.revision = topology.revision + 1
    topology = next
    repairSelection()
    return TerminalTabGroupCreationResult(
      groupID: groupID,
      deletedEmptyGroupIDs: deletedEmptyGroupIDs,
      topologyRevision: next.revision
    )
  }

  @discardableResult
  func renameGroup(_ id: TerminalTabGroupID, title: String) -> Bool {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty, var group = topology.groupsByID[id] else { return false }
    group.title = normalizedTitle
    topology.groupsByID[id] = group
    return true
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: ThemeTint) -> Bool {
    guard var group = topology.groupsByID[id] else { return false }
    group.color = color
    topology.groupsByID[id] = group
    return true
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    var next = topology
    let applied = try Self.applyMove(request, to: &next)
    if next != topology {
      next.revision = topology.revision + 1
      topology = next
      repairSelection()
    }
    guard let location = Self.location(of: request.itemIDs[0], in: topology) else {
      preconditionFailure("Moved item must have a final location")
    }
    return TerminalTabMoveResult(
      operationID: request.operationID,
      itemIDs: request.itemIDs,
      location: location,
      deletedEmptyGroupIDs: applied.deletedEmptyGroupIDs,
      topologyRevision: topology.revision
    )
  }

  static func prepareTransfer(
    _ request: TerminalTabTransferRequest,
    from source: TerminalTabCollection,
    to destination: TerminalTabCollection
  ) throws -> TransferPlan {
    guard source !== destination else { throw TerminalTabTransferError.sameCollection }
    guard request.expectedSourceRevision == source.topology.revision else {
      throw TerminalTabTransferError.staleSource(
        expected: request.expectedSourceRevision,
        actual: source.topology.revision
      )
    }
    guard request.expectedDestinationRevision == destination.topology.revision else {
      throw TerminalTabTransferError.staleDestination(
        expected: request.expectedDestinationRevision,
        actual: destination.topology.revision
      )
    }

    var sourceTopology = source.topology
    var destinationTopology = destination.topology
    let extracted: ExtractedItems
    do {
      extracted = try extract(request.itemIDs, from: &sourceTopology)
      try insert(
        request.itemIDs,
        extracted: extracted,
        at: request.destination,
        into: &destinationTopology
      )
    } catch let error as TerminalTabMoveError {
      throw TerminalTabTransferError.topology(error)
    }
    sourceTopology.revision += 1
    destinationTopology.revision += 1

    return TransferPlan(
      destinationTopology: destinationTopology,
      expectedDestinationRevision: request.expectedDestinationRevision,
      expectedSourceRevision: request.expectedSourceRevision,
      sourceTopology: sourceTopology,
      result: TerminalTabTransferResult(
        operationID: request.operationID,
        itemIDs: request.itemIDs,
        tabIDs: extracted.tabIDs,
        destination: request.destination,
        deletedEmptyGroupIDs: extracted.deletedEmptyGroupIDs,
        sourceRevision: sourceTopology.revision,
        destinationRevision: destinationTopology.revision
      )
    )
  }

  @discardableResult
  static func commitTransfer(
    _ plan: TransferPlan,
    from source: TerminalTabCollection,
    to destination: TerminalTabCollection
  ) throws -> TerminalTabTransferResult {
    guard source !== destination else { throw TerminalTabTransferError.sameCollection }
    guard source.topology.revision == plan.expectedSourceRevision else {
      throw TerminalTabTransferError.staleSource(
        expected: plan.expectedSourceRevision,
        actual: source.topology.revision
      )
    }
    guard destination.topology.revision == plan.expectedDestinationRevision else {
      throw TerminalTabTransferError.staleDestination(
        expected: plan.expectedDestinationRevision,
        actual: destination.topology.revision
      )
    }

    source.topology = plan.sourceTopology
    destination.topology = plan.destinationTopology
    source.repairSelection()
    destination.selection.primaryTabID = plan.result.tabIDs.first
    return plan.result
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> TerminalTabMoveResult? {
    guard case .root(let placement) = Self.location(of: id, in: topology) else { return nil }
    return setPinned(id, isPinned: !placement.isPinned)
  }

  @discardableResult
  func setPinned(
    _ id: TerminalTabRootItemID,
    isPinned: Bool
  ) -> TerminalTabMoveResult? {
    guard case .root(let current) = Self.location(of: id, in: topology) else { return nil }
    let index =
      current.isPinned == isPinned
      ? current.index
      : Self.rootIDs(isPinned: isPinned, in: topology).count
    return try? move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: topology.revision,
        itemIDs: [id],
        destination: .root(TerminalRootPlacement(isPinned: isPinned, index: index))
      )
    )
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabID) -> TerminalTabMoveResult? {
    guard let location = Self.location(of: .tab(id), in: topology) else { return nil }
    switch location {
    case .root(let placement):
      return setPinned(.tab(id), isPinned: !placement.isPinned)
    case .group:
      guard let index = rootCount(isPinned: true, afterRemoving: [.tab(id)]) else { return nil }
      return try? move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: topology.revision,
          itemIDs: [.tab(id)],
          destination: .root(
            TerminalRootPlacement(isPinned: true, index: index)
          )
        )
      )
    }
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> TerminalTabMoveResult? {
    guard let location = Self.location(of: .tab(id), in: topology) else { return nil }
    switch location {
    case .root:
      return setPinned(.tab(id), isPinned: isPinned)
    case .group:
      guard isPinned else { return nil }
      guard let index = rootCount(isPinned: true, afterRemoving: [.tab(id)]) else { return nil }
      return try? move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: topology.revision,
          itemIDs: [.tab(id)],
          destination: .root(
            TerminalRootPlacement(isPinned: true, index: index)
          )
        )
      )
    }
  }

  @discardableResult
  func removeTabFromGroup(_ id: TerminalTabID) -> TerminalTabMoveResult? {
    guard case .group(let groupID, _) = Self.location(of: .tab(id), in: topology) else {
      return nil
    }
    guard case .root(let groupPlacement) = Self.location(of: .group(groupID), in: topology) else {
      return nil
    }
    let groupIsDeleted =
      topology.groupsByID[groupID]?.lifetime == .automatic
      && topology.childIDsByGroupID[groupID]?.count == 1
    return try? move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: topology.revision,
        itemIDs: [.tab(id)],
        destination: .root(
          TerminalRootPlacement(
            isPinned: groupPlacement.isPinned,
            index: groupPlacement.index + (groupIsDeleted ? 0 : 1)
          )
        )
      )
    )
  }

  @discardableResult
  func ungroup(_ id: TerminalTabGroupID) -> Bool {
    guard
      case .root(let placement) = Self.location(of: .group(id), in: topology),
      topology.groupsByID[id] != nil
    else {
      return false
    }
    let childIDs = topology.childIDsByGroupID[id] ?? []
    var next = topology
    if !childIDs.isEmpty {
      let request = TerminalTabMoveRequest(
        expectedTopologyRevision: next.revision,
        itemIDs: childIDs.map(TerminalTabRootItemID.tab),
        destination: .root(placement)
      )
      guard (try? Self.applyMove(request, to: &next)) != nil else { return false }
    }
    Self.deleteGroup(id, from: &next)
    next.revision = topology.revision + 1
    topology = next
    repairSelection()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard topology.groupsByID[id] != nil, topology.childIDsByGroupID[id]?.isEmpty == true else {
      return false
    }
    var next = topology
    Self.deleteGroup(id, from: &next)
    next.revision += 1
    topology = next
    return true
  }

  @discardableResult
  func closeTab(_ id: TerminalTabID) -> TerminalTabCloseResult? {
    let previousTabs = tabs
    guard let index = previousTabs.firstIndex(where: { $0.id == id }) else { return nil }
    let wasSelected = selectedTabID == id
    var next = topology
    let sourceGroupID: TerminalTabGroupID?
    if case .group(let groupID, _) = Self.location(of: .tab(id), in: next) {
      sourceGroupID = groupID
    } else {
      sourceGroupID = nil
    }
    Self.remove(.tab(id), from: &next)
    next.tabsByID[id] = nil
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
    if let sourceGroupID, Self.deleteAutomaticGroupIfEmpty(sourceGroupID, from: &next) {
      deletedEmptyGroupIDs = [sourceGroupID]
    } else {
      deletedEmptyGroupIDs = []
    }
    next.revision += 1
    topology = next
    if wasSelected {
      let remainingTabs = tabs
      if remainingTabs.indices.contains(index) {
        selection.primaryTabID = remainingTabs[index].id
      } else {
        selection.primaryTabID = remainingTabs.last?.id
      }
    }
    return TerminalTabCloseResult(
      deletedEmptyGroupIDs: deletedEmptyGroupIDs,
      topologyRevision: next.revision
    )
  }

  func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    let tabs = tabs
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return [] }
    let nextIndex = tabs.index(after: index)
    guard nextIndex < tabs.endIndex else { return [] }
    return tabs[nextIndex...].map(\.id)
  }

  func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    tabs.map(\.id).filter { $0 != id }
  }

  func groupID(containing tabID: TerminalTabID) -> TerminalTabGroupID? {
    guard case .group(let groupID, _) = Self.location(of: .tab(tabID), in: topology) else {
      return nil
    }
    return groupID
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    topology.childIDsByGroupID[groupID] ?? []
  }

  func group(for id: TerminalTabGroupID) -> TerminalTabGroupItem? {
    groupItem(for: id, in: topology)
  }

  func rootItemID(containing tabID: TerminalTabID) -> TerminalTabRootItemID? {
    guard let location = Self.location(of: .tab(tabID), in: topology) else { return nil }
    switch location {
    case .root:
      return .tab(tabID)
    case .group(let groupID, _):
      return .group(groupID)
    }
  }

  func isPinned(_ tabID: TerminalTabID) -> Bool? {
    guard let location = Self.location(of: .tab(tabID), in: topology) else { return nil }
    switch location {
    case .root(let placement):
      return placement.isPinned
    case .group:
      return false
    }
  }

  func restoreRootItems(
    _ rootItems: [TerminalTabRootItem],
    selectedTabID: TerminalTabID?
  ) {
    var next = TerminalTabTopology(revision: topology.revision + 1)
    var seenTabIDs: Set<TerminalTabID> = []
    var seenGroupIDs: Set<TerminalTabGroupID> = []
    let normalizedItems = rootItems.filter(\.isPinned) + rootItems.filter { !$0.isPinned }
    for item in normalizedItems {
      switch item {
      case .tab(let item):
        guard seenTabIDs.insert(item.tab.id).inserted else { continue }
        next.tabsByID[item.tab.id] = item.tab
        Self.appendRootID(.tab(item.tab.id), isPinned: item.isPinned, to: &next)
      case .group(let group):
        guard seenGroupIDs.insert(group.id).inserted else { continue }
        let tabs = group.tabs.filter { seenTabIDs.insert($0.id).inserted }
        next.groupsByID[group.id] = TerminalTabGroup(
          id: group.id,
          title: group.title,
          color: group.color,
          lifetime: group.lifetime
        )
        next.childIDsByGroupID[group.id] = tabs.map(\.id)
        for tab in tabs {
          next.tabsByID[tab.id] = tab
        }
        Self.appendRootID(.group(group.id), isPinned: group.isPinned, to: &next)
      }
    }
    topology = next
    selection.primaryTabID =
      selectedTabID.flatMap { next.tabsByID[$0]?.id }
      ?? tabs.first?.id
  }

  private func updateTab(_ id: TerminalTabID, update: (inout TerminalTabItem) -> Void) {
    guard var tab = topology.tabsByID[id] else { return }
    update(&tab)
    topology.tabsByID[id] = tab
  }

  private func groupInsertion(
    containing tabIDs: [TerminalTabID],
    in topology: TerminalTabTopology
  ) -> TerminalRootPlacement? {
    guard let firstTabID = tabIDs.first else { return nil }
    guard let location = Self.location(of: .tab(firstTabID), in: topology) else { return nil }
    let rootID: TerminalTabRootItemID
    let followsSourceRoot: Bool
    switch location {
    case .root:
      rootID = .tab(firstTabID)
      followsSourceRoot = false
    case .group(let groupID, _):
      rootID = .group(groupID)
      followsSourceRoot = true
    }
    guard case .root(let rootPlacement) = Self.location(of: rootID, in: topology) else {
      return nil
    }
    let selectedRootIDs = Set(tabIDs.map(TerminalTabRootItemID.tab))
    let roots = Self.rootIDs(isPinned: rootPlacement.isPinned, in: topology)
    guard let rootIndex = roots.firstIndex(of: rootID) else { return nil }
    let index =
      roots[..<rootIndex].count { !selectedRootIDs.contains($0) }
      + (followsSourceRoot ? 1 : 0)
    return TerminalRootPlacement(isPinned: rootPlacement.isPinned, index: index)
  }

  private func rootItem(
    for id: TerminalTabRootItemID,
    in topology: TerminalTabTopology
  ) -> TerminalTabRootItem? {
    guard case .root(let placement) = Self.location(of: id, in: topology) else { return nil }
    switch id {
    case .tab(let tabID):
      guard let tab = topology.tabsByID[tabID] else { return nil }
      return .tab(TerminalUngroupedTabItem(tab: tab, isPinned: placement.isPinned))
    case .group(let groupID):
      return groupItem(for: groupID, in: topology).map(TerminalTabRootItem.group)
    }
  }

  private func groupItem(
    for id: TerminalTabGroupID,
    in topology: TerminalTabTopology
  ) -> TerminalTabGroupItem? {
    guard
      let group = topology.groupsByID[id],
      case .root(let placement) = Self.location(of: .group(id), in: topology)
    else {
      return nil
    }
    return TerminalTabGroupItem(
      id: group.id,
      title: group.title,
      color: group.color,
      isPinned: placement.isPinned,
      tabs: (topology.childIDsByGroupID[id] ?? []).compactMap { topology.tabsByID[$0] },
      lifetime: group.lifetime
    )
  }

  private func repairSelection() {
    selection.repair(validTabIDs: tabs.map(\.id))
  }

  private static func extract(
    _ itemIDs: [TerminalTabRootItemID],
    from topology: inout TerminalTabTopology
  ) throws -> ExtractedItems {
    let source = try moveSource(for: itemIDs, in: topology)
    var childIDsByGroupID: [TerminalTabGroupID: [TerminalTabID]] = [:]
    var groupsByID: [TerminalTabGroupID: TerminalTabGroup] = [:]
    var tabIDs: [TerminalTabID] = []
    var tabsByID: [TerminalTabID: TerminalTabItem] = [:]

    for itemID in itemIDs {
      switch itemID {
      case .tab(let tabID):
        guard let tab = topology.tabsByID[tabID] else {
          throw TerminalTabMoveError.itemNotFound(itemID)
        }
        tabIDs.append(tabID)
        tabsByID[tabID] = tab
        remove(itemID, from: &topology)
        topology.tabsByID[tabID] = nil

      case .group(let groupID):
        guard let group = topology.groupsByID[groupID] else {
          throw TerminalTabMoveError.itemNotFound(itemID)
        }
        let childIDs = topology.childIDsByGroupID[groupID] ?? []
        groupsByID[groupID] = group
        childIDsByGroupID[groupID] = childIDs
        for tabID in childIDs {
          guard let tab = topology.tabsByID[tabID] else {
            throw TerminalTabMoveError.itemNotFound(.tab(tabID))
          }
          tabIDs.append(tabID)
          tabsByID[tabID] = tab
          topology.tabsByID[tabID] = nil
        }
        remove(itemID, from: &topology)
        topology.groupsByID[groupID] = nil
        topology.childIDsByGroupID[groupID] = nil
      }
    }

    let deletedEmptyGroupIDs = source.groupIDs.filter {
      deleteAutomaticGroupIfEmpty($0, from: &topology)
    }
    return ExtractedItems(
      childIDsByGroupID: childIDsByGroupID,
      deletedEmptyGroupIDs: deletedEmptyGroupIDs,
      groupsByID: groupsByID,
      tabIDs: tabIDs,
      tabsByID: tabsByID
    )
  }

  private static func insert(
    _ itemIDs: [TerminalTabRootItemID],
    extracted: ExtractedItems,
    at destination: TerminalTabPlacement,
    into topology: inout TerminalTabTopology
  ) throws {
    try validateDestination(destination, for: itemIDs, in: topology)
    for tabID in extracted.tabIDs {
      guard topology.tabsByID[tabID] == nil else {
        throw TerminalTabTransferError.destinationContainsTab(tabID)
      }
    }
    for groupID in extracted.groupsByID.keys {
      guard topology.groupsByID[groupID] == nil else {
        throw TerminalTabTransferError.destinationContainsGroup(groupID)
      }
    }

    for (tabID, tab) in extracted.tabsByID {
      topology.tabsByID[tabID] = tab
    }
    for (groupID, group) in extracted.groupsByID {
      topology.groupsByID[groupID] = group
      topology.childIDsByGroupID[groupID] = extracted.childIDsByGroupID[groupID] ?? []
    }
    try insertMovedItems(itemIDs, at: destination, in: &topology)
  }

  private static func applyMove(
    _ request: TerminalTabMoveRequest,
    to topology: inout TerminalTabTopology
  ) throws -> AppliedMove {
    guard request.expectedTopologyRevision == topology.revision else {
      throw TerminalTabMoveError.staleTopology(
        expected: request.expectedTopologyRevision,
        actual: topology.revision
      )
    }
    let source = try moveSource(for: request.itemIDs, in: topology)
    try validateDestination(request.destination, for: request.itemIDs, in: topology)
    for itemID in request.itemIDs {
      remove(itemID, from: &topology)
    }
    var deletedEmptyGroupIDs: [TerminalTabGroupID] = []
    let destinationGroupID: TerminalTabGroupID? =
      switch request.destination {
      case .group(let groupID, _): groupID
      case .root: nil
      }
    for groupID in source.groupIDs
    where groupID != destinationGroupID
      && deleteAutomaticGroupIfEmpty(groupID, from: &topology)
    {
      deletedEmptyGroupIDs.append(groupID)
    }
    try insertMovedItems(request.itemIDs, at: request.destination, in: &topology)
    return AppliedMove(
      deletedEmptyGroupIDs: deletedEmptyGroupIDs
    )
  }

  func rootCount(
    isPinned: Bool,
    afterRemoving itemIDs: [TerminalTabRootItemID]
  ) -> Int? {
    guard let source = try? Self.moveSource(for: itemIDs, in: topology) else { return nil }
    var projected = topology
    for itemID in itemIDs {
      Self.remove(itemID, from: &projected)
    }
    for groupID in source.groupIDs {
      _ = Self.deleteAutomaticGroupIfEmpty(groupID, from: &projected)
    }
    return Self.rootIDs(isPinned: isPinned, in: projected).count
  }

  private static func moveSource(
    for itemIDs: [TerminalTabRootItemID],
    in topology: TerminalTabTopology
  ) throws -> MoveSource {
    guard !itemIDs.isEmpty else { throw TerminalTabMoveError.emptyItems }
    let requestedGroupIDs = Set(
      itemIDs.compactMap { itemID -> TerminalTabGroupID? in
        guard case .group(let groupID) = itemID else { return nil }
        return groupID
      })
    for itemID in itemIDs {
      guard case .tab(let tabID) = itemID else { continue }
      guard
        case .group(let groupID, _) = location(of: itemID, in: topology),
        requestedGroupIDs.contains(groupID)
      else { continue }
      throw TerminalTabMoveError.ancestorAndDescendant(groupID, tabID)
    }
    var seenIDs: Set<TerminalTabRootItemID> = []
    var sourceGroupIDs: [TerminalTabGroupID] = []
    for itemID in itemIDs {
      guard seenIDs.insert(itemID).inserted else {
        throw TerminalTabMoveError.duplicateItem(itemID)
      }
      guard let location = location(of: itemID, in: topology) else {
        throw TerminalTabMoveError.itemNotFound(itemID)
      }
      if case .tab = itemID, case .group(let groupID, _) = location,
        !sourceGroupIDs.contains(groupID)
      {
        sourceGroupIDs.append(groupID)
      }
    }
    return MoveSource(groupIDs: sourceGroupIDs)
  }

  private static func validateDestination(
    _ destination: TerminalTabPlacement,
    for itemIDs: [TerminalTabRootItemID],
    in topology: TerminalTabTopology
  ) throws {
    if case .group(let groupID, _) = destination {
      guard topology.groupsByID[groupID] != nil else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
      guard itemIDs.allSatisfy({ if case .tab = $0 { true } else { false } }) else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
    }
  }

  private static func insertMovedItems(
    _ itemIDs: [TerminalTabRootItemID],
    at destination: TerminalTabPlacement,
    in topology: inout TerminalTabTopology
  ) throws {
    switch destination {
    case .root(let placement):
      guard insertRootIDs(itemIDs, at: placement, in: &topology) else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
    case .group(let groupID, let index):
      guard var childIDs = topology.childIDsByGroupID[groupID],
        (0...childIDs.count).contains(index)
      else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
      let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
        guard case .tab(let tabID) = itemID else { return nil }
        return tabID
      }
      childIDs.insert(contentsOf: tabIDs, at: index)
      topology.childIDsByGroupID[groupID] = childIDs
    }
  }

  private static func location(
    of id: TerminalTabRootItemID,
    in topology: TerminalTabTopology
  ) -> TerminalTabPlacement? {
    if let index = topology.pinnedRootIDs.firstIndex(of: id) {
      return .root(TerminalRootPlacement(isPinned: true, index: index))
    }
    if let index = topology.regularRootIDs.firstIndex(of: id) {
      return .root(TerminalRootPlacement(isPinned: false, index: index))
    }
    guard case .tab(let tabID) = id else { return nil }
    for (groupID, childIDs) in topology.childIDsByGroupID {
      if let index = childIDs.firstIndex(of: tabID) {
        return .group(groupID, index: index)
      }
    }
    return nil
  }

  private static func remove(
    _ id: TerminalTabRootItemID,
    from topology: inout TerminalTabTopology
  ) {
    topology.pinnedRootIDs.removeAll { $0 == id }
    topology.regularRootIDs.removeAll { $0 == id }
    guard case .tab(let tabID) = id else { return }
    for groupID in topology.childIDsByGroupID.keys {
      topology.childIDsByGroupID[groupID]?.removeAll { $0 == tabID }
    }
  }

  private static func insertTabID(
    _ id: TerminalTabID,
    at placement: TerminalTabPlacement,
    in topology: inout TerminalTabTopology
  ) -> Bool {
    switch placement {
    case .root(let placement):
      return insertRootIDs([.tab(id)], at: placement, in: &topology)
    case .group(let groupID, let index):
      guard var childIDs = topology.childIDsByGroupID[groupID],
        (0...childIDs.count).contains(index)
      else {
        return false
      }
      childIDs.insert(id, at: index)
      topology.childIDsByGroupID[groupID] = childIDs
      return true
    }
  }

  private static func insertRootID(
    _ id: TerminalTabRootItemID,
    at placement: TerminalRootPlacement,
    in topology: inout TerminalTabTopology
  ) -> Bool {
    insertRootIDs([id], at: placement, in: &topology)
  }

  private static func insertRootIDs(
    _ ids: [TerminalTabRootItemID],
    at placement: TerminalRootPlacement,
    in topology: inout TerminalTabTopology
  ) -> Bool {
    if placement.isPinned {
      guard (0...topology.pinnedRootIDs.count).contains(placement.index) else { return false }
      topology.pinnedRootIDs.insert(contentsOf: ids, at: placement.index)
    } else {
      guard (0...topology.regularRootIDs.count).contains(placement.index) else { return false }
      topology.regularRootIDs.insert(contentsOf: ids, at: placement.index)
    }
    return true
  }

  private static func appendRootID(
    _ id: TerminalTabRootItemID,
    isPinned: Bool,
    to topology: inout TerminalTabTopology
  ) {
    if isPinned {
      topology.pinnedRootIDs.append(id)
    } else {
      topology.regularRootIDs.append(id)
    }
  }

  private static func rootIDs(
    isPinned: Bool,
    in topology: TerminalTabTopology
  ) -> [TerminalTabRootItemID] {
    isPinned ? topology.pinnedRootIDs : topology.regularRootIDs
  }

  private static func deleteAutomaticGroupIfEmpty(
    _ id: TerminalTabGroupID,
    from topology: inout TerminalTabTopology
  ) -> Bool {
    guard topology.groupsByID[id]?.lifetime == .automatic else { return false }
    guard topology.childIDsByGroupID[id]?.isEmpty == true else { return false }
    deleteGroup(id, from: &topology)
    return true
  }

  private static func deleteGroup(
    _ id: TerminalTabGroupID,
    from topology: inout TerminalTabTopology
  ) {
    remove(.group(id), from: &topology)
    topology.groupsByID[id] = nil
    topology.childIDsByGroupID[id] = nil
  }
}
