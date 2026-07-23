import Foundation

extension TerminalHostState {
  @discardableResult
  func createGroup(
    title: String,
    color: TerminalTabGroupColor = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupCreationResult? {
    let spaceID: TerminalSpaceID?
    if tabIDs.isEmpty {
      spaceID = selectedSpaceID
    } else {
      let spaceIDs = Set(tabIDs.compactMap { spaceManager.space(for: $0)?.id })
      guard spaceIDs.count == 1, tabIDs.allSatisfy({ spaceManager.tab(for: $0) != nil }) else {
        return nil
      }
      spaceID = spaceIDs.first
    }
    guard let spaceID, let manager = spaceManager.tabManager(for: spaceID) else { return nil }
    let previousRevision = manager.topologyRevision
    guard let result = manager.createGroup(title: title, color: color, containing: tabIDs) else {
      return nil
    }
    finishTopologyMutation(
      deletedEmptyGroupIDs: result.deletedEmptyGroupIDs,
      topologyRevision: result.topologyRevision,
      previousRevision: previousRevision,
      spaceID: spaceID
    )
    return result
  }

  @discardableResult
  func renameGroup(_ id: TerminalTabGroupID, title: String) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.renameGroup(id, title: title) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: TerminalTabGroupColor) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.setGroupColor(id, color: color) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setGroupCollapsed(_ id: TerminalTabGroupID, isCollapsed: Bool) -> Bool {
    guard let space = spaceManager.space(for: id) else { return false }
    var collapsedGroupIDs = collapsedTabGroupIDsBySpace[space.id] ?? []
    let changed: Bool
    if isCollapsed {
      changed = collapsedGroupIDs.insert(id).inserted
    } else {
      changed = collapsedGroupIDs.remove(id) != nil
    }
    guard changed else { return false }
    collapsedTabGroupIDsBySpace[space.id] = collapsedGroupIDs
    sessionDidChange()
    return true
  }

  @discardableResult
  func toggleGroupCollapsed(_ id: TerminalTabGroupID) -> Bool {
    guard let space = spaceManager.space(for: id) else { return false }
    let isCollapsed = collapsedTabGroupIDsBySpace[space.id]?.contains(id) == true
    return setGroupCollapsed(id, isCollapsed: !isCollapsed)
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    guard let firstID = request.itemIDs.first else { throw TerminalTabMoveError.emptyItems }
    guard let space = space(for: firstID) else { throw TerminalTabMoveError.itemNotFound(firstID) }
    guard request.itemIDs.allSatisfy({ self.space(for: $0)?.id == space.id }) else {
      throw TerminalTabMoveError.invalidDestination(request.destination)
    }
    guard let manager = spaceManager.tabManager(for: space.id) else {
      throw TerminalTabMoveError.itemNotFound(firstID)
    }
    let previousRevision = manager.topologyRevision
    let revealsGroup = request.itemIDs.contains { itemID in
      guard case .tab(let tabID) = itemID else { return false }
      return manager.selectedTabId == tabID
    }
    let result = try manager.move(request)
    var presentationChanged = removeCollapsedGroups(result.deletedEmptyGroupIDs, in: space.id)
    if revealsGroup, case .group(let groupID, _) = request.destination {
      presentationChanged = removeCollapsedGroups([groupID], in: space.id) || presentationChanged
    }
    if result.topologyRevision != previousRevision || presentationChanged {
      sessionDidChange()
    }
    return result
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> TerminalTabMoveResult? {
    guard
      let space = spaceManager.space(for: id),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return nil
    }
    let previousRevision = manager.topologyRevision
    guard let result = manager.togglePinned(id) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: space.id)
    return result
  }

  @discardableResult
  func setPinned(
    _ id: TerminalTabRootItemID,
    isPinned: Bool
  ) -> TerminalTabMoveResult? {
    guard
      let space = spaceManager.space(for: id),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return nil
    }
    let previousRevision = manager.topologyRevision
    guard let result = manager.setPinned(id, isPinned: isPinned) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: space.id)
    return result
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> TerminalTabMoveResult? {
    guard
      let space = spaceManager.space(for: id),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return nil
    }
    let previousRevision = manager.topologyRevision
    guard let result = manager.setTabPinned(id, isPinned: isPinned) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: space.id)
    return result
  }

  @discardableResult
  func removeTabFromGroup(_ id: TerminalTabID) -> TerminalTabMoveResult? {
    guard
      let space = spaceManager.space(for: id),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return nil
    }
    let previousRevision = manager.topologyRevision
    guard let result = manager.removeTabFromGroup(id) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: space.id)
    return result
  }

  @discardableResult
  func ungroup(_ id: TerminalTabGroupID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.ungroup(id) == true
    else {
      return false
    }
    collapsedTabGroupIDsBySpace[space.id]?.remove(id)
    sessionDidChange()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.deleteEmptyGroup(id) == true
    else {
      return false
    }
    collapsedTabGroupIDsBySpace[space.id]?.remove(id)
    sessionDidChange()
    return true
  }

  private func space(for id: TerminalTabRootItemID) -> TerminalSpaceItem? {
    switch id {
    case .tab(let tabID):
      spaceManager.space(for: tabID)
    case .group(let groupID):
      spaceManager.space(for: groupID)
    }
  }

  func finishMove(
    _ result: TerminalTabMoveResult,
    previousRevision: UInt64,
    spaceID: TerminalSpaceID
  ) {
    finishTopologyMutation(
      deletedEmptyGroupIDs: result.deletedEmptyGroupIDs,
      topologyRevision: result.topologyRevision,
      previousRevision: previousRevision,
      spaceID: spaceID
    )
  }

  func finishTopologyMutation(
    deletedEmptyGroupIDs: [TerminalTabGroupID],
    topologyRevision: UInt64,
    previousRevision: UInt64,
    spaceID: TerminalSpaceID
  ) {
    let presentationChanged = removeCollapsedGroups(deletedEmptyGroupIDs, in: spaceID)
    if topologyRevision != previousRevision || presentationChanged {
      sessionDidChange()
    }
  }

  @discardableResult
  func removeCollapsedGroups(
    _ groupIDs: [TerminalTabGroupID],
    in spaceID: TerminalSpaceID
  ) -> Bool {
    guard var collapsedGroupIDs = collapsedTabGroupIDsBySpace[spaceID] else { return false }
    let previousCount = collapsedGroupIDs.count
    collapsedGroupIDs.subtract(groupIDs)
    guard collapsedGroupIDs.count != previousCount else { return false }
    collapsedTabGroupIDsBySpace[spaceID] = collapsedGroupIDs
    return true
  }
}
