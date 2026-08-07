import Foundation

extension TerminalHostState {
  struct LiveTabTransferPlan {
    fileprivate let collectionPlan: TerminalTabCollection.TransferPlan
    fileprivate let destinationInstance: TerminalSpaceInstance
    fileprivate let didMoveSelectedTab: Bool
    fileprivate let sourceInstance: TerminalSpaceInstance
    let surfaceIDs: Set<UUID>
    let tabIDs: [TerminalTabID]
  }

  static func prepareLiveTabTransfer(
    _ request: TerminalTabTransferRequest,
    from source: TerminalHostState,
    sourceSpaceID: TerminalSpaceID,
    to destination: TerminalHostState,
    destinationSpaceID: TerminalSpaceID
  ) throws -> LiveTabTransferPlan {
    source.warmInstance(for: sourceSpaceID)
    destination.warmInstance(for: destinationSpaceID)
    guard
      let sourceInstance = source.spaceManager.instance(for: sourceSpaceID),
      destination.spaceManager.space(for: destinationSpaceID) != nil
    else {
      throw TerminalTabTransferError.invalidSpace
    }
    let destinationInstance = destination.spaceManager.instance(warming: destinationSpaceID)
    if source !== destination {
      guard source.runtime === destination.runtime else {
        throw TerminalTabTransferError.incompatibleRuntime
      }
    }
    let collectionPlan = try TerminalTabCollection.prepareTransfer(
      request,
      from: sourceInstance.tabCollection,
      to: destinationInstance.tabCollection
    )
    let tabIDs = collectionPlan.result.tabIDs
    if source.managesTerminalSurfaces {
      guard tabIDs.allSatisfy({ source.trees[$0] != nil }) else {
        throw TerminalTabTransferError.missingLiveTree
      }
    }
    let surfaceIDs = Set(tabIDs.flatMap { source.trees[$0]?.leaves().map(\.id) ?? [] })
    if source !== destination {
      guard surfaceIDs.allSatisfy({ destination.surfaces[$0] == nil }) else {
        throw TerminalTabTransferError.destinationContainsSurface
      }
    }
    return LiveTabTransferPlan(
      collectionPlan: collectionPlan,
      destinationInstance: destinationInstance,
      didMoveSelectedTab: sourceInstance.selectedTabID.map(tabIDs.contains) == true,
      sourceInstance: sourceInstance,
      surfaceIDs: surfaceIDs,
      tabIDs: tabIDs
    )
  }

  @discardableResult
  static func commitLiveTabTransfer(
    _ plan: LiveTabTransferPlan,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) throws -> TerminalTabTransferResult {
    let result = try TerminalTabCollection.commitTransfer(
      plan.collectionPlan,
      from: plan.sourceInstance.tabCollection,
      to: plan.destinationInstance.tabCollection
    )
    updateGroupState(plan, result: result)
    if source !== destination {
      moveOwnership(plan, from: source, to: destination)
    }
    updateSelection(plan, result: result, source: source, destination: destination)
    source.sessionDidChange()
    if source !== destination {
      destination.sessionDidChange()
    }
    return result
  }

  private static func moveOwnership(
    _ plan: LiveTabTransferPlan,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) {
    let trees = Dictionary(
      uniqueKeysWithValues: plan.tabIDs.compactMap { tabID in
        source.trees.removeValue(forKey: tabID).map { (tabID, $0) }
      }
    )
    let surfaces = Dictionary(
      uniqueKeysWithValues: plan.surfaceIDs.compactMap { surfaceID in
        source.surfaces.removeValue(forKey: surfaceID).map { (surfaceID, $0) }
      }
    )
    let focusHistories = Dictionary(
      uniqueKeysWithValues: plan.tabIDs.compactMap { tabID in
        source.focusHistoryByTab.removeValue(forKey: tabID).map { (tabID, $0) }
      }
    )
    let notifications = source.notificationStore.take(plan.surfaceIDs)
    let metadata = Dictionary(
      uniqueKeysWithValues: plan.surfaceIDs.compactMap { surfaceID in
        source.paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID).map { (surfaceID, $0) }
      }
    )
    let agentSnapshots = plan.surfaceIDs.flatMap { source.agentStateStore.snapshots(for: $0) }
    for surfaceID in plan.surfaceIDs {
      source.agentStateStore.clearSessions(for: surfaceID)
      source.agentPanelController?.surfaceRemoved(surfaceID)
    }

    destination.trees.merge(trees) { _, _ in preconditionFailure() }
    destination.surfaces.merge(surfaces) { _, _ in preconditionFailure() }
    destination.focusHistoryByTab.merge(focusHistories) { _, _ in preconditionFailure() }
    destination.notificationStore.merge(notifications)
    destination.paneAgentMetadataBySurfaceID.merge(metadata) { _, _ in preconditionFailure() }
    destination.agentStateStore.restore(agentSnapshots)

    for tabID in plan.tabIDs {
      rebind(tree: destination.trees[tabID], tabID: tabID, to: destination)
    }
    if source.lastEmittedFocusSurfaceID.map(plan.surfaceIDs.contains) == true {
      source.lastEmittedFocusSurfaceID = nil
    }
    destination.lastEmittedFocusSurfaceID = nil
  }

  private static func updateGroupState(
    _ plan: LiveTabTransferPlan,
    result: TerminalTabTransferResult
  ) {
    let movedGroupIDs = Set(
      result.itemIDs.compactMap { itemID -> TerminalTabGroupID? in
        guard case .group(let groupID) = itemID else { return nil }
        return groupID
      })
    let movedCollapsedGroupIDs = plan.sourceInstance.collapsedTabGroupIDs.intersection(movedGroupIDs)
    plan.sourceInstance.collapsedTabGroupIDs.subtract(result.deletedEmptyGroupIDs)
    plan.sourceInstance.collapsedTabGroupIDs.subtract(movedGroupIDs)
    plan.destinationInstance.collapsedTabGroupIDs.formUnion(movedCollapsedGroupIDs)
    if plan.sourceInstance.previousSelectedTabID.map(plan.tabIDs.contains) == true {
      plan.sourceInstance.previousSelectedTabID = nil
    }
  }

  private static func rebind(
    tree: SplitTree<GhosttySurfaceView>?,
    tabID: TerminalTabID,
    to destination: TerminalHostState
  ) {
    for surface in tree?.leaves() ?? [] {
      destination.configureBridgeCallbacks(for: surface, tabID: tabID)
      destination.configureSurfaceCallbacks(for: surface, tabID: tabID)
      destination.agentPanelController?.surfacePathChanged(surface.id)
      destination.agentPanelController?.surfaceAgentStateChanged(surface.id)
    }
  }

  private static func updateSelection(
    _ plan: LiveTabTransferPlan,
    result: TerminalTabTransferResult,
    source: TerminalHostState,
    destination: TerminalHostState
  ) {
    source.updateSelectionAfterClosingTab(
      in: plan.sourceInstance.spaceID,
      didCloseSelectedTab: plan.didMoveSelectedTab
    )
    if let selectedTabID = result.tabIDs.first {
      destination.applySelectedTab(selectedTabID, in: plan.destinationInstance.spaceID)
    }
    source.syncFocus(source.windowActivity)
    if source !== destination {
      destination.syncFocus(destination.windowActivity)
    }
  }
}
