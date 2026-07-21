import Foundation
import Observation

@MainActor
@Observable
final class TerminalTabManager {
  private struct Storage: Equatable {
    var tabsByID: [TerminalTabID: TerminalTabItem] = [:]
    var groupsByID: [TerminalTabGroupID: TerminalTabGroup] = [:]
    var pinnedRootIDs: [TerminalTabRootItemID] = []
    var regularRootIDs: [TerminalTabRootItemID] = []
    var childIDsByGroupID: [TerminalTabGroupID: [TerminalTabID]] = [:]
    var topologyRevision: UInt64 = 0
  }

  private struct AppliedMove {
    let deletedEmptyGroupIDs: [TerminalTabGroupID]
  }

  private struct MoveSource {
    let groupIDs: [TerminalTabGroupID]
  }

  private var storage = Storage()
  var selectedTabId: TerminalTabID?

  var topologyRevision: UInt64 {
    storage.topologyRevision
  }

  var rootItems: [TerminalTabRootItem] {
    (storage.pinnedRootIDs + storage.regularRootIDs).compactMap {
      rootItem(for: $0, in: storage)
    }
  }

  var tabs: [TerminalTabItem] {
    rootItems.flatMap(\.tabs)
  }

  var pinnedRootItems: [TerminalTabRootItem] {
    storage.pinnedRootIDs.compactMap { rootItem(for: $0, in: storage) }
  }

  var regularRootItems: [TerminalTabRootItem] {
    storage.regularRootIDs.compactMap { rootItem(for: $0, in: storage) }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    let placement = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: storage.regularRootIDs.count)
    )
    return createTab(title: title, isTitleLocked: isTitleLocked, at: placement)!
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false,
    at placement: TerminalTabPlacement
  ) -> TerminalTabID? {
    let tab = TerminalTabItem(title: title, isTitleLocked: isTitleLocked)
    var next = storage
    guard Self.insertTabID(tab.id, at: placement, in: &next) else { return nil }
    next.tabsByID[tab.id] = tab
    next.topologyRevision += 1
    storage = next
    selectedTabId = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard storage.tabsByID[id] != nil else { return }
    selectedTabId = id
  }

  func clearSelection() {
    selectedTabId = nil
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
    color: TerminalTabGroupColor = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupCreationResult? {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty else { return nil }
    guard Set(tabIDs).count == tabIDs.count else { return nil }
    guard tabIDs.allSatisfy({ storage.tabsByID[$0] != nil }) else { return nil }

    let insertion = groupInsertion(containing: tabIDs, in: storage)
    guard tabIDs.isEmpty || insertion != nil else { return nil }
    let resolvedInsertion =
      insertion
      ?? TerminalRootPlacement(isPinned: false, index: storage.regularRootIDs.count)
    let groupID = TerminalTabGroupID()
    var next = storage
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
        expectedTopologyRevision: next.topologyRevision,
        itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
        destination: .group(groupID, index: 0)
      )
      guard let applied = try? Self.applyMove(request, to: &next) else { return nil }
      deletedEmptyGroupIDs = applied.deletedEmptyGroupIDs
    } else {
      deletedEmptyGroupIDs = []
    }
    next.topologyRevision = storage.topologyRevision + 1
    storage = next
    repairSelection()
    return TerminalTabGroupCreationResult(
      groupID: groupID,
      deletedEmptyGroupIDs: deletedEmptyGroupIDs,
      topologyRevision: next.topologyRevision
    )
  }

  @discardableResult
  func renameGroup(_ id: TerminalTabGroupID, title: String) -> Bool {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty, var group = storage.groupsByID[id] else { return false }
    group.title = normalizedTitle
    storage.groupsByID[id] = group
    return true
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: TerminalTabGroupColor) -> Bool {
    guard var group = storage.groupsByID[id] else { return false }
    group.color = color
    storage.groupsByID[id] = group
    return true
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    var next = storage
    let applied = try Self.applyMove(request, to: &next)
    if next != storage {
      next.topologyRevision = storage.topologyRevision + 1
      storage = next
      repairSelection()
    }
    guard let location = Self.location(of: request.itemIDs[0], in: storage) else {
      preconditionFailure("Moved item must have a final location")
    }
    return TerminalTabMoveResult(
      operationID: request.operationID,
      itemIDs: request.itemIDs,
      location: location,
      deletedEmptyGroupIDs: applied.deletedEmptyGroupIDs,
      topologyRevision: storage.topologyRevision
    )
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> TerminalTabMoveResult? {
    guard case .root(let placement) = Self.location(of: id, in: storage) else { return nil }
    return setPinned(id, isPinned: !placement.isPinned)
  }

  @discardableResult
  func setPinned(
    _ id: TerminalTabRootItemID,
    isPinned: Bool
  ) -> TerminalTabMoveResult? {
    guard case .root(let current) = Self.location(of: id, in: storage) else { return nil }
    let index =
      current.isPinned == isPinned
      ? current.index
      : Self.rootIDs(isPinned: isPinned, in: storage).count
    return try? move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: storage.topologyRevision,
        itemIDs: [id],
        destination: .root(TerminalRootPlacement(isPinned: isPinned, index: index))
      )
    )
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabID) -> TerminalTabMoveResult? {
    guard let location = Self.location(of: .tab(id), in: storage) else { return nil }
    switch location {
    case .root(let placement):
      return setPinned(.tab(id), isPinned: !placement.isPinned)
    case .group:
      guard let index = rootCount(isPinned: true, afterRemoving: [.tab(id)]) else { return nil }
      return try? move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: storage.topologyRevision,
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
    guard let location = Self.location(of: .tab(id), in: storage) else { return nil }
    switch location {
    case .root:
      return setPinned(.tab(id), isPinned: isPinned)
    case .group:
      guard isPinned else { return nil }
      guard let index = rootCount(isPinned: true, afterRemoving: [.tab(id)]) else { return nil }
      return try? move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: storage.topologyRevision,
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
    guard case .group(let groupID, _) = Self.location(of: .tab(id), in: storage) else {
      return nil
    }
    guard case .root(let groupPlacement) = Self.location(of: .group(groupID), in: storage) else {
      return nil
    }
    let groupIsDeleted =
      storage.groupsByID[groupID]?.lifetime == .automatic
      && storage.childIDsByGroupID[groupID]?.count == 1
    return try? move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: storage.topologyRevision,
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
      case .root(let placement) = Self.location(of: .group(id), in: storage),
      storage.groupsByID[id] != nil
    else {
      return false
    }
    let childIDs = storage.childIDsByGroupID[id] ?? []
    var next = storage
    if !childIDs.isEmpty {
      let request = TerminalTabMoveRequest(
        expectedTopologyRevision: next.topologyRevision,
        itemIDs: childIDs.map(TerminalTabRootItemID.tab),
        destination: .root(placement)
      )
      guard (try? Self.applyMove(request, to: &next)) != nil else { return false }
    }
    Self.deleteGroup(id, from: &next)
    next.topologyRevision = storage.topologyRevision + 1
    storage = next
    repairSelection()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard storage.groupsByID[id] != nil, storage.childIDsByGroupID[id]?.isEmpty == true else {
      return false
    }
    var next = storage
    Self.deleteGroup(id, from: &next)
    next.topologyRevision += 1
    storage = next
    return true
  }

  @discardableResult
  func closeTab(_ id: TerminalTabID) -> TerminalTabCloseResult? {
    let previousTabs = tabs
    guard let index = previousTabs.firstIndex(where: { $0.id == id }) else { return nil }
    let wasSelected = selectedTabId == id
    var next = storage
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
    next.topologyRevision += 1
    storage = next
    if wasSelected {
      let remainingTabs = tabs
      if remainingTabs.indices.contains(index) {
        selectedTabId = remainingTabs[index].id
      } else {
        selectedTabId = remainingTabs.last?.id
      }
    }
    return TerminalTabCloseResult(
      deletedEmptyGroupIDs: deletedEmptyGroupIDs,
      topologyRevision: next.topologyRevision
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
    guard case .group(let groupID, _) = Self.location(of: .tab(tabID), in: storage) else {
      return nil
    }
    return groupID
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    storage.childIDsByGroupID[groupID] ?? []
  }

  func group(for id: TerminalTabGroupID) -> TerminalTabGroupItem? {
    groupItem(for: id, in: storage)
  }

  func rootItemID(containing tabID: TerminalTabID) -> TerminalTabRootItemID? {
    guard let location = Self.location(of: .tab(tabID), in: storage) else { return nil }
    switch location {
    case .root:
      return .tab(tabID)
    case .group(let groupID, _):
      return .group(groupID)
    }
  }

  func isPinned(_ tabID: TerminalTabID) -> Bool? {
    guard let location = Self.location(of: .tab(tabID), in: storage) else { return nil }
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
    var next = Storage(topologyRevision: storage.topologyRevision + 1)
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
    storage = next
    selectedTabId =
      selectedTabID.flatMap { next.tabsByID[$0]?.id }
      ?? tabs.first?.id
  }

  private func updateTab(_ id: TerminalTabID, update: (inout TerminalTabItem) -> Void) {
    guard var tab = storage.tabsByID[id] else { return }
    update(&tab)
    storage.tabsByID[id] = tab
  }

  private func groupInsertion(
    containing tabIDs: [TerminalTabID],
    in storage: Storage
  ) -> TerminalRootPlacement? {
    guard let firstTabID = tabIDs.first else { return nil }
    guard let location = Self.location(of: .tab(firstTabID), in: storage) else { return nil }
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
    guard case .root(let rootPlacement) = Self.location(of: rootID, in: storage) else {
      return nil
    }
    let selectedRootIDs = Set(tabIDs.map(TerminalTabRootItemID.tab))
    let roots = Self.rootIDs(isPinned: rootPlacement.isPinned, in: storage)
    guard let rootIndex = roots.firstIndex(of: rootID) else { return nil }
    let index =
      roots[..<rootIndex].count { !selectedRootIDs.contains($0) }
      + (followsSourceRoot ? 1 : 0)
    return TerminalRootPlacement(isPinned: rootPlacement.isPinned, index: index)
  }

  private func rootItem(
    for id: TerminalTabRootItemID,
    in storage: Storage
  ) -> TerminalTabRootItem? {
    guard case .root(let placement) = Self.location(of: id, in: storage) else { return nil }
    switch id {
    case .tab(let tabID):
      guard let tab = storage.tabsByID[tabID] else { return nil }
      return .tab(TerminalUngroupedTabItem(tab: tab, isPinned: placement.isPinned))
    case .group(let groupID):
      return groupItem(for: groupID, in: storage).map(TerminalTabRootItem.group)
    }
  }

  private func groupItem(
    for id: TerminalTabGroupID,
    in storage: Storage
  ) -> TerminalTabGroupItem? {
    guard
      let group = storage.groupsByID[id],
      case .root(let placement) = Self.location(of: .group(id), in: storage)
    else {
      return nil
    }
    return TerminalTabGroupItem(
      id: group.id,
      title: group.title,
      color: group.color,
      isPinned: placement.isPinned,
      tabs: (storage.childIDsByGroupID[id] ?? []).compactMap { storage.tabsByID[$0] },
      lifetime: group.lifetime
    )
  }

  private func repairSelection() {
    guard selectedTabId.flatMap({ storage.tabsByID[$0] }) == nil else { return }
    selectedTabId = tabs.first?.id
  }

  private static func applyMove(
    _ request: TerminalTabMoveRequest,
    to storage: inout Storage
  ) throws -> AppliedMove {
    guard request.expectedTopologyRevision == storage.topologyRevision else {
      throw TerminalTabMoveError.staleTopology(
        expected: request.expectedTopologyRevision,
        actual: storage.topologyRevision
      )
    }
    let source = try moveSource(for: request.itemIDs, in: storage)
    try validateDestination(request.destination, for: request.itemIDs, in: storage)
    for itemID in request.itemIDs {
      remove(itemID, from: &storage)
    }
    var deletedEmptyGroupIDs: [TerminalTabGroupID] = []
    let destinationGroupID: TerminalTabGroupID? =
      switch request.destination {
      case .group(let groupID, _): groupID
      case .root: nil
      }
    for groupID in source.groupIDs
    where groupID != destinationGroupID
      && deleteAutomaticGroupIfEmpty(groupID, from: &storage)
    {
      deletedEmptyGroupIDs.append(groupID)
    }
    try insertMovedItems(request.itemIDs, at: request.destination, in: &storage)
    return AppliedMove(
      deletedEmptyGroupIDs: deletedEmptyGroupIDs
    )
  }

  func rootCount(
    isPinned: Bool,
    afterRemoving itemIDs: [TerminalTabRootItemID]
  ) -> Int? {
    guard let source = try? Self.moveSource(for: itemIDs, in: storage) else { return nil }
    var projected = storage
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
    in storage: Storage
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
        case .group(let groupID, _) = location(of: itemID, in: storage),
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
      guard let location = location(of: itemID, in: storage) else {
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
    in storage: Storage
  ) throws {
    if case .group(let groupID, _) = destination {
      guard storage.groupsByID[groupID] != nil else {
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
    in storage: inout Storage
  ) throws {
    switch destination {
    case .root(let placement):
      guard insertRootIDs(itemIDs, at: placement, in: &storage) else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
    case .group(let groupID, let index):
      guard var childIDs = storage.childIDsByGroupID[groupID],
        (0...childIDs.count).contains(index)
      else {
        throw TerminalTabMoveError.invalidDestination(destination)
      }
      let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
        guard case .tab(let tabID) = itemID else { return nil }
        return tabID
      }
      childIDs.insert(contentsOf: tabIDs, at: index)
      storage.childIDsByGroupID[groupID] = childIDs
    }
  }

  private static func location(
    of id: TerminalTabRootItemID,
    in storage: Storage
  ) -> TerminalTabPlacement? {
    if let index = storage.pinnedRootIDs.firstIndex(of: id) {
      return .root(TerminalRootPlacement(isPinned: true, index: index))
    }
    if let index = storage.regularRootIDs.firstIndex(of: id) {
      return .root(TerminalRootPlacement(isPinned: false, index: index))
    }
    guard case .tab(let tabID) = id else { return nil }
    for (groupID, childIDs) in storage.childIDsByGroupID {
      if let index = childIDs.firstIndex(of: tabID) {
        return .group(groupID, index: index)
      }
    }
    return nil
  }

  private static func remove(
    _ id: TerminalTabRootItemID,
    from storage: inout Storage
  ) {
    storage.pinnedRootIDs.removeAll { $0 == id }
    storage.regularRootIDs.removeAll { $0 == id }
    guard case .tab(let tabID) = id else { return }
    for groupID in storage.childIDsByGroupID.keys {
      storage.childIDsByGroupID[groupID]?.removeAll { $0 == tabID }
    }
  }

  private static func insertTabID(
    _ id: TerminalTabID,
    at placement: TerminalTabPlacement,
    in storage: inout Storage
  ) -> Bool {
    switch placement {
    case .root(let placement):
      return insertRootIDs([.tab(id)], at: placement, in: &storage)
    case .group(let groupID, let index):
      guard var childIDs = storage.childIDsByGroupID[groupID],
        (0...childIDs.count).contains(index)
      else {
        return false
      }
      childIDs.insert(id, at: index)
      storage.childIDsByGroupID[groupID] = childIDs
      return true
    }
  }

  private static func insertRootID(
    _ id: TerminalTabRootItemID,
    at placement: TerminalRootPlacement,
    in storage: inout Storage
  ) -> Bool {
    insertRootIDs([id], at: placement, in: &storage)
  }

  private static func insertRootIDs(
    _ ids: [TerminalTabRootItemID],
    at placement: TerminalRootPlacement,
    in storage: inout Storage
  ) -> Bool {
    if placement.isPinned {
      guard (0...storage.pinnedRootIDs.count).contains(placement.index) else { return false }
      storage.pinnedRootIDs.insert(contentsOf: ids, at: placement.index)
    } else {
      guard (0...storage.regularRootIDs.count).contains(placement.index) else { return false }
      storage.regularRootIDs.insert(contentsOf: ids, at: placement.index)
    }
    return true
  }

  private static func appendRootID(
    _ id: TerminalTabRootItemID,
    isPinned: Bool,
    to storage: inout Storage
  ) {
    if isPinned {
      storage.pinnedRootIDs.append(id)
    } else {
      storage.regularRootIDs.append(id)
    }
  }

  private static func rootIDs(
    isPinned: Bool,
    in storage: Storage
  ) -> [TerminalTabRootItemID] {
    isPinned ? storage.pinnedRootIDs : storage.regularRootIDs
  }

  private static func deleteAutomaticGroupIfEmpty(
    _ id: TerminalTabGroupID,
    from storage: inout Storage
  ) -> Bool {
    guard storage.groupsByID[id]?.lifetime == .automatic else { return false }
    guard storage.childIDsByGroupID[id]?.isEmpty == true else { return false }
    deleteGroup(id, from: &storage)
    return true
  }

  private static func deleteGroup(
    _ id: TerminalTabGroupID,
    from storage: inout Storage
  ) {
    remove(.group(id), from: &storage)
    storage.groupsByID[id] = nil
    storage.childIDsByGroupID[id] = nil
  }
}
