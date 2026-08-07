import Foundation

extension TerminalHostState {
  struct LiveTabSplitTarget {
    let host: TerminalHostState
    let side: TerminalTabSplitSide
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  struct LiveTabSplitPlan {
    fileprivate let destinationInstance: TerminalSpaceInstance
    fileprivate let destinationTabID: TerminalTabID
    fileprivate let didMoveSelectedTab: Bool
    fileprivate let extractionPlan: TerminalTabCollection.ExtractionPlan
    fileprivate let incomingFocusedSurfaceID: UUID?
    fileprivate let joinedTree: SplitTree<GhosttySurfaceView>
    fileprivate let side: TerminalTabSplitSide
    fileprivate let sourceInstance: TerminalSpaceInstance
    fileprivate let sourceTabID: TerminalTabID
    let surfaceIDs: Set<UUID>
  }

  struct LiveTabTransferPlan {
    fileprivate let collectionPlan: TerminalTabCollection.TransferPlan
    fileprivate let destinationInstance: TerminalSpaceInstance
    fileprivate let didMoveSelectedTab: Bool
    fileprivate let sourceInstance: TerminalSpaceInstance
    let surfaceIDs: Set<UUID>
    let tabIDs: [TerminalTabID]
  }

  private struct LiveTabOwnership {
    let agentSnapshots: [TerminalAgentStateSnapshot]
    let focusHistories: [TerminalTabID: FocusHistory]
    let metadata: [UUID: PaneAgentMetadata]
    let notifications: TerminalNotificationStore
    let surfaces: [UUID: GhosttySurfaceView]
    let trees: [TerminalTabID: SplitTree<GhosttySurfaceView>]
  }

  static func prepareLiveTabTransfer(
    _ request: TerminalTabTransferRequest,
    from source: TerminalHostState,
    sourceSpaceID: TerminalSpaceID,
    to destination: TerminalHostState,
    destinationSpaceID: TerminalSpaceID
  ) throws -> LiveTabTransferPlan {
    let instances = try transferInstances(
      from: source,
      sourceSpaceID: sourceSpaceID,
      to: destination,
      destinationSpaceID: destinationSpaceID
    )
    let collectionPlan = try TerminalTabCollection.prepareTransfer(
      request,
      from: instances.source.tabCollection,
      to: instances.destination.tabCollection
    )
    let tabIDs = collectionPlan.result.tabIDs
    if source.managesTerminalSurfaces {
      guard tabIDs.allSatisfy({ source.trees[$0] != nil }) else {
        throw TerminalTabTransferError.missingLiveTree
      }
    }
    let surfaceIDs = Set(tabIDs.flatMap { source.trees[$0]?.leaves().map(\.id) ?? [] })
    try validateSurfaceOwnership(surfaceIDs, from: source, to: destination)
    return LiveTabTransferPlan(
      collectionPlan: collectionPlan,
      destinationInstance: instances.destination,
      didMoveSelectedTab: instances.source.selectedTabID.map(tabIDs.contains) == true,
      sourceInstance: instances.source,
      surfaceIDs: surfaceIDs,
      tabIDs: tabIDs
    )
  }

  static func prepareLiveTabSplit(
    payload: TerminalTabDragPayload,
    from source: TerminalHostState,
    to target: LiveTabSplitTarget
  ) throws -> LiveTabSplitPlan {
    let destination = target.host
    guard payload.itemIDs.count == 1, case .tab(let sourceTabID) = payload.itemIDs[0] else {
      throw TerminalTabTransferError.invalidSplitSource
    }
    guard sourceTabID != target.tabID else {
      throw TerminalTabTransferError.invalidSplitDestination
    }
    let instances = try transferInstances(
      from: source,
      sourceSpaceID: payload.sourceSpaceID,
      to: destination,
      destinationSpaceID: target.spaceID
    )
    guard instances.destination.tabCollection.tabs.contains(where: { $0.id == target.tabID })
    else {
      throw TerminalTabTransferError.invalidSplitDestination
    }
    guard
      let sourceTree = source.trees[sourceTabID],
      let destinationTree = destination.trees[target.tabID],
      let joinedTree = destinationTree.joining(
        sourceTree,
        direction: .horizontal,
        placingOtherAfter: target.side == .right
      )
    else {
      throw TerminalTabTransferError.missingLiveTree
    }
    let extractionPlan = try TerminalTabCollection.prepareExtraction(
      TerminalTabExtractionRequest(
        operationID: payload.moveOperationID,
        expectedTopologyRevision: payload.sourceTopologyRevision,
        itemIDs: payload.itemIDs
      ),
      from: instances.source.tabCollection
    )
    let surfaceIDs = Set(sourceTree.leaves().map(\.id))
    try validateSurfaceOwnership(surfaceIDs, from: source, to: destination)
    return LiveTabSplitPlan(
      destinationInstance: instances.destination,
      destinationTabID: target.tabID,
      didMoveSelectedTab: instances.source.selectedTabID == sourceTabID,
      extractionPlan: extractionPlan,
      incomingFocusedSurfaceID: source.focusHistoryByTab[sourceTabID]?.current
        ?? sourceTree.leaves().first?.id,
      joinedTree: joinedTree,
      side: target.side,
      sourceInstance: instances.source,
      sourceTabID: sourceTabID,
      surfaceIDs: surfaceIDs
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
    notifySessionChange(source: source, destination: destination)
    return result
  }

  @discardableResult
  static func commitLiveTabSplit(
    _ plan: LiveTabSplitPlan,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) throws -> TerminalTabSplitResult {
    let extraction = try TerminalTabCollection.commitExtraction(
      plan.extractionPlan,
      from: plan.sourceInstance.tabCollection
    )
    if source === destination {
      source.trees.removeValue(forKey: plan.sourceTabID)
      source.focusHistoryByTab.removeValue(forKey: plan.sourceTabID)
    } else {
      let ownership = takeOwnership(
        tabIDs: [plan.sourceTabID],
        surfaceIDs: plan.surfaceIDs,
        from: source
      )
      installOwnership(ownership, in: destination, includesTabState: false)
    }
    destination.trees[plan.destinationTabID] = plan.joinedTree
    if let incomingFocusedSurfaceID = plan.incomingFocusedSurfaceID {
      destination.focusHistoryByTab[
        plan.destinationTabID,
        default: FocusHistory(current: incomingFocusedSurfaceID)
      ].updateCurrent(incomingFocusedSurfaceID)
    }
    if source.lastEmittedFocusSurfaceID.map(plan.surfaceIDs.contains) == true {
      source.lastEmittedFocusSurfaceID = nil
    }
    destination.lastEmittedFocusSurfaceID = nil
    plan.sourceInstance.collapsedTabGroupIDs.subtract(extraction.deletedEmptyGroupIDs)
    if plan.sourceInstance.previousSelectedTabID == plan.sourceTabID {
      plan.sourceInstance.previousSelectedTabID = nil
    }
    rebind(tree: plan.joinedTree, tabID: plan.destinationTabID, to: destination)
    source.updateSelectionAfterClosingTab(
      in: plan.sourceInstance.spaceID,
      didCloseSelectedTab: plan.didMoveSelectedTab
    )
    destination.applySelectedTab(plan.destinationTabID, in: plan.destinationInstance.spaceID)
    source.syncFocus(source.windowActivity)
    if source !== destination {
      destination.syncFocus(destination.windowActivity)
    }
    notifySessionChange(source: source, destination: destination)
    return TerminalTabSplitResult(
      operationID: extraction.operationID,
      sourceTabID: plan.sourceTabID,
      destinationTabID: plan.destinationTabID,
      side: plan.side,
      sourceRevision: extraction.topologyRevision
    )
  }

  private static func transferInstances(
    from source: TerminalHostState,
    sourceSpaceID: TerminalSpaceID,
    to destination: TerminalHostState,
    destinationSpaceID: TerminalSpaceID
  ) throws -> (source: TerminalSpaceInstance, destination: TerminalSpaceInstance) {
    source.warmInstance(for: sourceSpaceID)
    destination.warmInstance(for: destinationSpaceID)
    guard
      let sourceInstance = source.spaceManager.instance(for: sourceSpaceID),
      destination.spaceManager.space(for: destinationSpaceID) != nil
    else {
      throw TerminalTabTransferError.invalidSpace
    }
    if source !== destination, source.runtime !== destination.runtime {
      throw TerminalTabTransferError.incompatibleRuntime
    }
    return (
      sourceInstance,
      destination.spaceManager.instance(warming: destinationSpaceID)
    )
  }

  private static func validateSurfaceOwnership(
    _ surfaceIDs: Set<UUID>,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) throws {
    guard source !== destination else { return }
    guard surfaceIDs.allSatisfy({ destination.surfaces[$0] == nil }) else {
      throw TerminalTabTransferError.destinationContainsSurface
    }
  }

  private static func moveOwnership(
    _ plan: LiveTabTransferPlan,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) {
    let ownership = takeOwnership(
      tabIDs: plan.tabIDs,
      surfaceIDs: plan.surfaceIDs,
      from: source
    )
    installOwnership(ownership, in: destination, includesTabState: true)
    for tabID in plan.tabIDs {
      rebind(tree: destination.trees[tabID], tabID: tabID, to: destination)
    }
    if source.lastEmittedFocusSurfaceID.map(plan.surfaceIDs.contains) == true {
      source.lastEmittedFocusSurfaceID = nil
    }
    destination.lastEmittedFocusSurfaceID = nil
  }

  private static func takeOwnership(
    tabIDs: [TerminalTabID],
    surfaceIDs: Set<UUID>,
    from source: TerminalHostState
  ) -> LiveTabOwnership {
    let ownership = LiveTabOwnership(
      agentSnapshots: surfaceIDs.flatMap { source.agentStateStore.snapshots(for: $0) },
      focusHistories: Dictionary(
        uniqueKeysWithValues: tabIDs.compactMap { tabID in
          source.focusHistoryByTab.removeValue(forKey: tabID).map { (tabID, $0) }
        }
      ),
      metadata: Dictionary(
        uniqueKeysWithValues: surfaceIDs.compactMap { surfaceID in
          source.paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID).map {
            (surfaceID, $0)
          }
        }
      ),
      notifications: source.notificationStore.take(surfaceIDs),
      surfaces: Dictionary(
        uniqueKeysWithValues: surfaceIDs.compactMap { surfaceID in
          source.surfaces.removeValue(forKey: surfaceID).map { (surfaceID, $0) }
        }
      ),
      trees: Dictionary(
        uniqueKeysWithValues: tabIDs.compactMap { tabID in
          source.trees.removeValue(forKey: tabID).map { (tabID, $0) }
        }
      )
    )
    for surfaceID in surfaceIDs {
      source.agentStateStore.clearSessions(for: surfaceID)
      source.agentPanelController?.surfaceRemoved(surfaceID)
    }
    return ownership
  }

  private static func installOwnership(
    _ ownership: LiveTabOwnership,
    in destination: TerminalHostState,
    includesTabState: Bool
  ) {
    destination.surfaces.merge(ownership.surfaces) { _, _ in preconditionFailure() }
    destination.notificationStore.merge(ownership.notifications)
    destination.paneAgentMetadataBySurfaceID.merge(ownership.metadata) { _, _ in
      preconditionFailure()
    }
    destination.agentStateStore.restore(ownership.agentSnapshots)
    if includesTabState {
      destination.trees.merge(ownership.trees) { _, _ in preconditionFailure() }
      destination.focusHistoryByTab.merge(ownership.focusHistories) { _, _ in
        preconditionFailure()
      }
    }
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

  private static func notifySessionChange(
    source: TerminalHostState,
    destination: TerminalHostState
  ) {
    source.sessionDidChange()
    if source !== destination {
      destination.sessionDidChange()
    }
  }
}
