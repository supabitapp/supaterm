import Foundation
import Observation
import SupaTheme

@MainActor
@Observable
final class TerminalTabCollection {
  struct ExtractionPlan {
    fileprivate let deletedEmptyGroupIDs: [TerminalTabGroupID]
    fileprivate let expectedTopologyRevision: UInt64
    fileprivate let topology: TerminalTabTopology
  }

  struct TransferPlan {
    fileprivate let destinationTopology: TerminalTabTopology
    fileprivate let expectedDestinationRevision: UInt64
    fileprivate let expectedSourceRevision: UInt64
    fileprivate let sourceTopology: TerminalTabTopology
    let result: TerminalTabTransferResult
  }

  private var topology = TerminalTabTopology()
  private(set) var selectedTabID: TerminalTabID?

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
    createTab(
      id: TerminalTabID(),
      title: title,
      isTitleLocked: isTitleLocked,
      at: placement
    )
  }

  func createTab(
    id: TerminalTabID,
    title: String,
    isTitleLocked: Bool = false,
    at placement: TerminalTabPlacement
  ) -> TerminalTabID? {
    let tab = TerminalTabItem(id: id, title: title, isTitleLocked: isTitleLocked)
    var next = topology
    guard next.tabsByID[id] == nil else { return nil }
    guard next.insertTabID(tab.id, at: placement) else { return nil }
    next.tabsByID[tab.id] = tab
    next.revision += 1
    topology = next
    selectedTabID = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard topology.tabsByID[id] != nil else { return }
    selectedTabID = id
  }

  func clearSelection() {
    selectedTabID = nil
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
    guard next.insertRootID(.group(groupID), at: resolvedInsertion) else {
      return nil
    }
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
    if !tabIDs.isEmpty {
      let request = TerminalTabMoveRequest(
        expectedTopologyRevision: next.revision,
        itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
        destination: .group(groupID, index: 0)
      )
      guard let applied = try? next.apply(request) else { return nil }
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
    let applied = try next.apply(request)
    if next != topology {
      next.revision = topology.revision + 1
      topology = next
      repairSelection()
    }
    guard let location = topology.location(of: request.itemIDs[0]) else {
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
    let extracted: TerminalTabTopology.ExtractedItems
    do {
      extracted = try sourceTopology.extract(request.itemIDs)
      try destinationTopology.insert(
        request.itemIDs,
        extracted: extracted,
        at: request.destination
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
        tabIDs: extracted.tabIDs,
        deletedEmptyGroupIDs: extracted.deletedEmptyGroupIDs
      )
    )
  }

  static func prepareExtraction(
    _ request: TerminalTabExtractionRequest,
    from source: TerminalTabCollection
  ) throws -> ExtractionPlan {
    guard request.expectedTopologyRevision == source.topology.revision else {
      throw TerminalTabTransferError.staleSource(
        expected: request.expectedTopologyRevision,
        actual: source.topology.revision
      )
    }
    var topology = source.topology
    let extracted: TerminalTabTopology.ExtractedItems
    do {
      extracted = try topology.extract(request.itemIDs)
    } catch let error as TerminalTabMoveError {
      throw TerminalTabTransferError.topology(error)
    }
    topology.revision += 1
    return ExtractionPlan(
      deletedEmptyGroupIDs: extracted.deletedEmptyGroupIDs,
      expectedTopologyRevision: request.expectedTopologyRevision,
      topology: topology
    )
  }

  static func commitExtraction(
    _ plan: ExtractionPlan,
    from source: TerminalTabCollection
  ) throws -> [TerminalTabGroupID] {
    guard source.topology.revision == plan.expectedTopologyRevision else {
      throw TerminalTabTransferError.staleSource(
        expected: plan.expectedTopologyRevision,
        actual: source.topology.revision
      )
    }
    source.topology = plan.topology
    source.repairSelection()
    return plan.deletedEmptyGroupIDs
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
    destination.selectedTabID = plan.result.tabIDs.first
    return plan.result
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> TerminalTabMoveResult? {
    guard case .root(let placement) = topology.location(of: id) else { return nil }
    return setPinned(id, isPinned: !placement.isPinned)
  }

  @discardableResult
  func setPinned(
    _ id: TerminalTabRootItemID,
    isPinned: Bool
  ) -> TerminalTabMoveResult? {
    guard case .root(let current) = topology.location(of: id) else { return nil }
    let index =
      current.isPinned == isPinned
      ? current.index
      : topology.rootIDs(isPinned: isPinned).count
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
    guard let location = topology.location(of: .tab(id)) else { return nil }
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
    guard let location = topology.location(of: .tab(id)) else { return nil }
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
    guard case .group(let groupID, _) = topology.location(of: .tab(id)) else {
      return nil
    }
    guard case .root(let groupPlacement) = topology.location(of: .group(groupID)) else {
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
      case .root(let placement) = topology.location(of: .group(id)),
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
      guard (try? next.apply(request)) != nil else { return false }
    }
    next.deleteGroup(id)
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
    next.deleteGroup(id)
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
    if case .group(let groupID, _) = next.location(of: .tab(id)) {
      sourceGroupID = groupID
    } else {
      sourceGroupID = nil
    }
    next.remove(.tab(id))
    next.tabsByID[id] = nil
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
    if let sourceGroupID, next.deleteAutomaticGroupIfEmpty(sourceGroupID) {
      deletedEmptyGroupIDs = [sourceGroupID]
    } else {
      deletedEmptyGroupIDs = []
    }
    next.revision += 1
    topology = next
    if wasSelected {
      let remainingTabs = tabs
      if remainingTabs.indices.contains(index) {
        selectedTabID = remainingTabs[index].id
      } else {
        selectedTabID = remainingTabs.last?.id
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
    guard case .group(let groupID, _) = topology.location(of: .tab(tabID)) else {
      return nil
    }
    return groupID
  }

  func placement(after tabID: TerminalTabID) -> TerminalTabPlacement? {
    guard let location = topology.location(of: .tab(tabID)) else { return nil }
    switch location {
    case .root(let placement):
      return .root(
        TerminalRootPlacement(
          isPinned: placement.isPinned,
          index: placement.index + 1
        )
      )
    case .group(let groupID, let index):
      return .group(groupID, index: index + 1)
    }
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    topology.childIDsByGroupID[groupID] ?? []
  }

  func group(for id: TerminalTabGroupID) -> TerminalTabGroupItem? {
    groupItem(for: id, in: topology)
  }

  func rootItemID(containing tabID: TerminalTabID) -> TerminalTabRootItemID? {
    guard let location = topology.location(of: .tab(tabID)) else { return nil }
    switch location {
    case .root:
      return .tab(tabID)
    case .group(let groupID, _):
      return .group(groupID)
    }
  }

  func isPinned(_ tabID: TerminalTabID) -> Bool? {
    guard let location = topology.location(of: .tab(tabID)) else { return nil }
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
        next.appendRootID(.tab(item.tab.id), isPinned: item.isPinned)
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
        next.appendRootID(.group(group.id), isPinned: group.isPinned)
      }
    }
    topology = next
    self.selectedTabID =
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
    guard let location = topology.location(of: .tab(firstTabID)) else { return nil }
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
    guard case .root(let rootPlacement) = topology.location(of: rootID) else {
      return nil
    }
    let selectedRootIDs = Set(tabIDs.map(TerminalTabRootItemID.tab))
    let roots = topology.rootIDs(isPinned: rootPlacement.isPinned)
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
    guard case .root(let placement) = topology.location(of: id) else { return nil }
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
      case .root(let placement) = topology.location(of: .group(id))
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
    guard selectedTabID.flatMap({ topology.tabsByID[$0] }) == nil else { return }
    selectedTabID = tabs.first?.id
  }

  func rootCount(
    isPinned: Bool,
    afterRemoving itemIDs: [TerminalTabRootItemID]
  ) -> Int? {
    guard let source = try? topology.moveSource(for: itemIDs) else { return nil }
    var projected = topology
    for itemID in itemIDs {
      projected.remove(itemID)
    }
    for groupID in source.groupIDs {
      _ = projected.deleteAutomaticGroupIfEmpty(groupID)
    }
    return projected.rootIDs(isPinned: isPinned).count
  }
}
