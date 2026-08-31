import Foundation
import SupaTheme

extension TerminalHostState {
  func contextSurfaceID(for groupID: TerminalTabGroupID) -> UUID? {
    guard
      let group = rootItems.compactMap({ root -> TerminalTabGroupItem? in
        guard case .group(let group) = root, group.id == groupID else { return nil }
        return group
      }).first,
      let tab = group.tabs.first(where: { $0.id == selectedTabID }) ?? group.tabs.first
    else { return nil }
    return contextSurfaceID(for: tab.id)
  }

  func suggestedGroupTitle(containing tabIDs: [TerminalTabID]) -> String? {
    guard let manager = instance(containing: tabIDs)?.tabCollection else { return nil }
    let tabs = tabIDs.compactMap(spaceManager.tab(for:))
    let sharedRepositoryName = TerminalTabGroupTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: tabIDs.map(paneWorkingDirectoryPaths)
    )
    let existingTitles = manager.rootItems.compactMap { root -> String? in
      guard case .group(let group) = root else { return nil }
      return group.title
    }
    return TerminalTabGroupTitleSuggester.title(
      for: tabs.map {
        TerminalTabGroupTitleInput(title: $0.title, isTitleLocked: $0.isTitleLocked)
      },
      sharedRepositoryName: sharedRepositoryName,
      existingTitles: existingTitles
    )
  }

  @discardableResult
  func createGroup(
    title: String,
    color: ThemeTint = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupCreationResult? {
    let spaceID: TerminalSpaceID
    if tabIDs.isEmpty {
      spaceID = displayedSpaceID
    } else {
      guard let instance = instance(containing: tabIDs) else { return nil }
      spaceID = instance.spaceID
    }
    guard let manager = spaceManager.tabCollection(for: spaceID) else { return nil }
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
    guard spaceManager.instance(for: id)?.tabCollection.renameGroup(id, title: title) == true else {
      return false
    }
    sessionDidChange()
    return true
  }

  func promptGroupTitle(_ id: TerminalTabGroupID) {
    guard
      let group = spaceManager.instance(for: id)?.tabCollection.group(for: id),
      let view = selectedSurfaceView
        ?? group.tabs.lazy.compactMap({ self.titleSurface(for: $0.id) }).first
    else { return }
    view.promptTitle(messageText: "Rename Group", initialValue: group.title) { [weak self] title in
      guard let title = Self.trimmedNonEmpty(title) else { return }
      _ = self?.renameGroup(id, title: title)
    }
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: ThemeTint) -> Bool {
    guard spaceManager.instance(for: id)?.tabCollection.setGroupColor(id, color: color) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  func isGroupCollapsed(_ id: TerminalTabGroupID, in spaceID: TerminalSpaceID) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID) else { return false }
    if let pendingSession = instance.pendingSession {
      return pendingSession.collapsedGroupIDs.contains(id)
    }
    return instance.collapsedTabGroupIDs.contains(id)
  }

  @discardableResult
  func setGroupCollapsed(_ id: TerminalTabGroupID, isCollapsed: Bool) -> Bool {
    guard let instance = spaceManager.instance(for: id) else { return false }
    let changed =
      isCollapsed
      ? instance.collapsedTabGroupIDs.insert(id).inserted
      : instance.collapsedTabGroupIDs.remove(id) != nil
    guard changed else { return false }
    sessionDidChange()
    return true
  }

  @discardableResult
  func toggleGroupCollapsed(_ id: TerminalTabGroupID) -> Bool {
    guard let instance = spaceManager.instance(for: id) else { return false }
    return setGroupCollapsed(id, isCollapsed: !instance.collapsedTabGroupIDs.contains(id))
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    guard let firstID = request.itemIDs.first else { throw TerminalTabMoveError.emptyItems }
    guard let instance = instance(for: firstID) else {
      throw TerminalTabMoveError.itemNotFound(firstID)
    }
    guard request.itemIDs.allSatisfy({ self.instance(for: $0) === instance }) else {
      throw TerminalTabMoveError.invalidDestination(request.destination)
    }
    let manager = instance.tabCollection
    let previousRevision = manager.topologyRevision
    let revealsGroup = request.itemIDs.contains { itemID in
      guard case .tab(let tabID) = itemID else { return false }
      return manager.selectedTabID == tabID
    }
    let result = try manager.move(request)
    var presentationChanged = removeCollapsedGroups(
      result.deletedEmptyGroupIDs,
      in: instance.spaceID
    )
    if revealsGroup, case .group(let groupID, _) = request.destination {
      presentationChanged =
        removeCollapsedGroups([groupID], in: instance.spaceID) || presentationChanged
    }
    if result.topologyRevision != previousRevision || presentationChanged {
      sessionDidChange()
    }
    return result
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> TerminalTabMoveResult? {
    guard let instance = instance(for: id) else { return nil }
    let previousRevision = instance.tabCollection.topologyRevision
    guard let result = instance.tabCollection.togglePinned(id) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: instance.spaceID)
    return result
  }

  @discardableResult
  func setPinned(
    _ id: TerminalTabRootItemID,
    isPinned: Bool
  ) -> TerminalTabMoveResult? {
    guard let instance = instance(for: id) else { return nil }
    let previousRevision = instance.tabCollection.topologyRevision
    guard let result = instance.tabCollection.setPinned(id, isPinned: isPinned) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: instance.spaceID)
    return result
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> TerminalTabMoveResult? {
    guard let instance = spaceManager.instance(for: id) else { return nil }
    let previousRevision = instance.tabCollection.topologyRevision
    guard let result = instance.tabCollection.setTabPinned(id, isPinned: isPinned) else {
      return nil
    }
    finishMove(result, previousRevision: previousRevision, spaceID: instance.spaceID)
    return result
  }

  @discardableResult
  func removeTabFromGroup(_ id: TerminalTabID) -> TerminalTabMoveResult? {
    guard let instance = spaceManager.instance(for: id) else { return nil }
    let previousRevision = instance.tabCollection.topologyRevision
    guard let result = instance.tabCollection.removeTabFromGroup(id) else { return nil }
    finishMove(result, previousRevision: previousRevision, spaceID: instance.spaceID)
    return result
  }

  @discardableResult
  func ungroup(_ id: TerminalTabGroupID) -> Bool {
    guard let instance = spaceManager.instance(for: id) else { return false }
    guard instance.tabCollection.ungroup(id) else { return false }
    instance.collapsedTabGroupIDs.remove(id)
    sessionDidChange()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard let instance = spaceManager.instance(for: id) else { return false }
    guard instance.tabCollection.deleteEmptyGroup(id) else { return false }
    instance.collapsedTabGroupIDs.remove(id)
    sessionDidChange()
    return true
  }

  private func instance(for id: TerminalTabRootItemID) -> TerminalSpaceInstance? {
    switch id {
    case .tab(let tabID):
      spaceManager.instance(for: tabID)
    case .group(let groupID):
      spaceManager.instance(for: groupID)
    }
  }

  private func instance(containing tabIDs: [TerminalTabID]) -> TerminalSpaceInstance? {
    let instances = tabIDs.compactMap { spaceManager.instance(for: $0) }
    guard let instance = instances.first, instances.count == tabIDs.count else { return nil }
    return instances.allSatisfy { $0 === instance } ? instance : nil
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
    guard let instance = spaceManager.instance(for: spaceID) else { return false }
    let previousCount = instance.collapsedTabGroupIDs.count
    instance.collapsedTabGroupIDs.subtract(groupIDs)
    return instance.collapsedTabGroupIDs.count != previousCount
  }
}
