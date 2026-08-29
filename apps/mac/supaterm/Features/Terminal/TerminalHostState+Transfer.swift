import Foundation

extension TerminalHostState {
  struct LiveTabMergeRequest {
    let expectedSourceRevision: UInt64
    let sourceSpaceID: TerminalSpaceID
    let sourceTabID: TerminalTabID
  }

  struct LiveTabSplitTarget {
    let host: TerminalHostState
    let zone: TerminalSplitDropZone
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  struct LiveTabMergePlan {
    fileprivate let destinationInstance: TerminalSpaceInstance
    fileprivate let destinationTabID: TerminalTabID
    fileprivate let didMoveSelectedTab: Bool
    fileprivate let extractionPlan: TerminalTabCollection.ExtractionPlan
    fileprivate let incomingFocusedSurfaceID: UUID?
    fileprivate let joinedTree: SplitTree<GhosttySurfaceView>
    fileprivate let sourceInstance: TerminalSpaceInstance
    fileprivate let sourceTabID: TerminalTabID
    let surfaceIDs: Set<UUID>
  }

  struct LiveTabTransferPlan {
    fileprivate let collectionPlan: TerminalTabCollection.TransferPlan
    fileprivate let destinationInstance: TerminalSpaceInstance
    fileprivate let didMoveSelectedTab: Bool
    fileprivate let movedGroupIDs: Set<TerminalTabGroupID>
    fileprivate let sourceInstance: TerminalSpaceInstance
    let surfaceIDs: Set<UUID>
    let tabIDs: [TerminalTabID]
  }

  private struct LiveTabOwnership {
    let agentCompletions: TerminalAgentCompletionStore
    let agentDetections: TerminalAgentDetectionStore
    let agentSnapshots: [TerminalAgentStateSnapshot]
    let focusHistories: [TerminalTabID: FocusHistory]
    let metadata: [UUID: PaneAgentMetadata]
    let notifications: TerminalNotificationStore
    let surfaces: [UUID: GhosttySurfaceView]
    let trees: [TerminalTabID: SplitTree<GhosttySurfaceView>]
  }

  private struct PaneTabMoveSource {
    let instance: TerminalSpaceInstance
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  func liveTabSplitTargetTabID(
    _ requestedTabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) -> TerminalTabID? {
    let tabs = spaceManager.tabs(in: spaceID)
    guard
      tabs.contains(where: { $0.id == requestedTabID }),
      isSelectableTab(requestedTabID)
    else { return nil }
    return requestedTabID
  }

  func splitSelectedTabWithNewPane(
    _ tabID: TerminalTabID,
    expectedTopologyRevision: UInt64,
    keepingExistingContentIn zone: TerminalSplitDropZone,
    in spaceID: TerminalSpaceID
  ) -> Bool {
    guard
      displayedSpaceID == spaceID,
      let instance = spaceManager.instance(for: spaceID),
      instance.tabCollection.topologyRevision == expectedTopologyRevision,
      instance.selectedTabID == tabID,
      let surface = selectedSurfaceView,
      self.tabID(containing: surface.id) == tabID
    else { return false }
    let direction: GhosttySplitAction.NewDirection =
      switch zone.opposite {
      case .top: .up
      case .bottom: .down
      case .left: .left
      case .right: .right
      }
    return performSplitAction(.newSplit(direction: direction), for: surface.id)
  }

  func mergeTabIntoSelectedTab(_ sourceTabID: TerminalTabID) -> Bool {
    guard
      let instance = spaceManager.instance(for: sourceTabID),
      instance.spaceID == displayedSpaceID,
      let destinationTabID = instance.selectedTabID,
      destinationTabID != sourceTabID,
      let plan = try? Self.prepareLiveTabMerge(
        LiveTabMergeRequest(
          expectedSourceRevision: instance.tabCollection.topologyRevision,
          sourceSpaceID: instance.spaceID,
          sourceTabID: sourceTabID
        ),
        from: self,
        to: LiveTabSplitTarget(
          host: self,
          zone: .right,
          spaceID: instance.spaceID,
          tabID: destinationTabID
        )
      )
    else { return false }
    return (try? Self.commitLiveTabMerge(plan, from: self, to: self)) != nil
  }

  func canMovePaneToNewTab(_ surfaceID: UUID) -> Bool {
    guard let tabID = tabID(containing: surfaceID) else { return false }
    return (trees[tabID]?.leaves().count ?? 0) > 1
  }

  @discardableResult
  func movePaneToNewTab(_ surfaceID: UUID) -> Bool {
    (try? movePanesToNewTabs(
      [surfaceID],
      reason: .user,
      selectsMovedPane: true
    )) != nil
  }

  @discardableResult
  func moveAllPanesToNewTabs(_ tabID: TerminalTabID) -> Bool {
    guard let leaves = trees[tabID]?.leaves(), leaves.count > 1 else { return false }
    let retainedSurfaceID = contextSurfaceID(for: tabID) ?? leaves[0].id
    return
      (try? movePanesToNewTabs(
        leaves.map(\.id).filter { $0 != retainedSurfaceID },
        reason: .user,
        selectsMovedPane: false
      )) != nil
  }

  func movePaneToNewTab(_ target: TerminalPaneTarget) throws -> SupatermNewTabResult {
    let resolvedTarget = try resolvePaneTarget(target)
    let surface = resolvedTarget.anchorSurface
    let tabIDs = try movePanesToNewTabs(
      [surface.id],
      reason: .socket,
      selectsMovedPane: true
    )
    guard
      let tabID = tabIDs.first,
      let tree = trees[tabID]
    else {
      throw TerminalCreateTabError.creationFailed
    }
    let location = try resolvedPaneLocation(
      spaceID: resolvedTarget.spaceID,
      tabID: tabID,
      surfaceID: surface.id,
      tree: tree
    )
    let selectionState = Self.newPaneSelectionState(
      selectedTabID: selectedTabID,
      targetTabID: tabID,
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surface: surface
    )
    return SupatermNewTabResult(
      isFocused: selectionState.isFocused,
      isSelectedSpace: resolvedTarget.spaceID == displayedSpaceID,
      isSelectedTab: selectionState.isSelectedTab,
      windowIndex: 1,
      spaceIndex: location.spaceIndex,
      spaceID: resolvedTarget.spaceID.rawValue,
      tabIndex: location.tabIndex,
      tabID: tabID.rawValue,
      paneIndex: location.paneIndex,
      paneID: surface.id
    )
  }

  func movePaneToNewTab(
    _ surfaceID: UUID,
    destinationTabID: TerminalTabID,
    at placement: TerminalTabPlacement,
    expectedTopologyRevision: UInt64
  ) throws -> TerminalTabID {
    let source = try paneTabMoveSource(for: [surfaceID])
    guard source.instance.tabCollection.topologyRevision == expectedTopologyRevision else {
      throw TerminalTabTransferError.staleSource(
        expected: expectedTopologyRevision,
        actual: source.instance.tabCollection.topologyRevision
      )
    }
    try requireTabCapacity(1, reason: .user)
    let previousSelectedTabID = source.instance.tabCollection.selectedTabID
    guard
      source.instance.tabCollection.createTab(
        id: destinationTabID,
        title: "Terminal \(nextTabIndex(in: source.instance.spaceID))",
        at: placement
      ) != nil
    else {
      throw TerminalCreateTabError.creationFailed
    }
    commitPaneMoves(
      [surfaceID],
      to: [destinationTabID],
      from: source,
      previousSelectedTabID: previousSelectedTabID,
      selectsMovedPane: true
    )
    return destinationTabID
  }

  private func movePanesToNewTabs(
    _ surfaceIDs: [UUID],
    reason: LicenseTabGate.CreationReason,
    selectsMovedPane: Bool
  ) throws -> [TerminalTabID] {
    let source = try paneTabMoveSource(for: surfaceIDs)
    try requireTabCapacity(surfaceIDs.count, reason: reason)

    let collection = source.instance.tabCollection
    let previousSelectedTabID = collection.selectedTabID
    let firstDefaultTitleIndex = nextTabIndex(in: source.instance.spaceID)
    var anchorTabID = source.tabID
    var createdTabIDs: [TerminalTabID] = []
    for offset in surfaceIDs.indices {
      guard
        let placement = collection.placement(after: anchorTabID),
        let tabID = collection.createTab(
          title: "Terminal \(firstDefaultTitleIndex + offset)",
          at: placement
        )
      else {
        for createdTabID in createdTabIDs.reversed() {
          collection.closeTab(createdTabID)
        }
        if let previousSelectedTabID {
          collection.selectTab(previousSelectedTabID)
        }
        throw TerminalCreateTabError.creationFailed
      }
      createdTabIDs.append(tabID)
      anchorTabID = tabID
    }

    commitPaneMoves(
      surfaceIDs,
      to: createdTabIDs,
      from: source,
      previousSelectedTabID: previousSelectedTabID,
      selectsMovedPane: selectsMovedPane
    )
    return createdTabIDs
  }

  private func paneTabMoveSource(
    for surfaceIDs: [UUID]
  ) throws -> PaneTabMoveSource {
    guard
      let firstSurfaceID = surfaceIDs.first,
      let sourceTabID = tabID(containing: firstSurfaceID),
      let sourceTree = trees[sourceTabID],
      let instance = spaceManager.instance(for: sourceTabID),
      Set(surfaceIDs).count == surfaceIDs.count,
      surfaceIDs.allSatisfy({ sourceTree.find(id: $0) != nil }),
      surfaceIDs.count < sourceTree.leaves().count
    else {
      throw TerminalControlError.paneRequiresSplit
    }
    return PaneTabMoveSource(instance: instance, tabID: sourceTabID, tree: sourceTree)
  }

  private func commitPaneMoves(
    _ surfaceIDs: [UUID],
    to createdTabIDs: [TerminalTabID],
    from source: PaneTabMoveSource,
    previousSelectedTabID: TerminalTabID?,
    selectsMovedPane: Bool
  ) {
    precondition(surfaceIDs.count == createdTabIDs.count)

    var remainingTree = source.tree
    for surfaceID in surfaceIDs {
      guard let node = remainingTree.find(id: surfaceID) else {
        preconditionFailure()
      }
      remainingTree = remainingTree.removing(node)
    }
    trees[source.tabID] = remainingTree

    let retainedSurfaceIDs = Set(remainingTree.leaves().map(\.id))
    if let current = focusHistoryByTab[source.tabID]?.current,
      !retainedSurfaceIDs.contains(current)
    {
      let nextSurfaceID =
        source.tree.find(id: current)
        .flatMap(source.tree.focusTargetAfterClosing)
        .map(\.id)
        .flatMap { retainedSurfaceIDs.contains($0) ? $0 : nil }
        ?? remainingTree.root?.leftmostLeaf().id
      if let nextSurfaceID {
        focusHistoryByTab[source.tabID] = FocusHistory(current: nextSurfaceID)
      }
    }

    for (surfaceID, tabID) in zip(surfaceIDs, createdTabIDs) {
      guard let surface = surfaces[surfaceID] else { preconditionFailure() }
      let tree = SplitTree(view: surface)
      trees[tabID] = tree
      focusHistoryByTab[tabID] = FocusHistory(current: surfaceID)
      Self.rebind(tree: tree, tabID: tabID, to: self)
      updateRunningState(for: tabID)
      updateTabTitle(for: tabID)
    }
    updateRunningState(for: source.tabID)
    updateTabTitle(for: source.tabID)

    if selectsMovedPane,
      let surfaceID = surfaceIDs.first,
      let tabID = createdTabIDs.first
    {
      switchSpace(to: source.instance.spaceID)
      applySelectedTab(tabID, in: source.instance.spaceID)
      if let surface = surfaces[surfaceID] {
        focusSurface(surface, in: tabID)
      }
    } else if let previousSelectedTabID {
      source.instance.tabCollection.selectTab(previousSelectedTabID)
    }

    syncFocus(windowActivity)
    sessionDidChange()
  }

  static func prepareLiveTabTransfer(
    _ request: TerminalTabTransferRequest,
    from source: TerminalHostState,
    sourceSpaceID: TerminalSpaceID,
    to destination: TerminalHostState,
    destinationSpaceID: TerminalSpaceID
  ) throws -> LiveTabTransferPlan {
    let restoresDestination = destination.spaceManager.instance(for: destinationSpaceID)?.pendingSession != nil
    let instances = try transferInstances(
      from: source,
      sourceSpaceID: sourceSpaceID,
      to: destination,
      destinationSpaceID: destinationSpaceID
    )
    let request =
      restoresDestination
      ? TerminalTabTransferRequest(
        expectedSourceRevision: request.expectedSourceRevision,
        expectedDestinationRevision: instances.destination.tabCollection.topologyRevision,
        itemIDs: request.itemIDs,
        destination: request.destination
      )
      : request
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
      movedGroupIDs: Set(
        request.itemIDs.compactMap { itemID in
          guard case .group(let groupID) = itemID else { return nil }
          return groupID
        }
      ),
      sourceInstance: instances.source,
      surfaceIDs: surfaceIDs,
      tabIDs: tabIDs
    )
  }

  static func prepareLiveTabMerge(
    _ request: LiveTabMergeRequest,
    from source: TerminalHostState,
    to target: LiveTabSplitTarget
  ) throws -> LiveTabMergePlan {
    let destination = target.host
    let instances = try transferInstances(
      from: source,
      sourceSpaceID: request.sourceSpaceID,
      to: destination,
      destinationSpaceID: target.spaceID
    )
    guard
      let destinationTabID = destination.liveTabSplitTargetTabID(
        target.tabID,
        in: target.spaceID
      ),
      destinationTabID != request.sourceTabID
    else {
      throw TerminalTabTransferError.invalidSplitDestination
    }
    guard
      let sourceTree = source.trees[request.sourceTabID],
      let destinationTree = destination.trees[destinationTabID],
      let joinedTree = destinationTree.joining(
        sourceTree,
        direction: target.zone.isHorizontal ? .horizontal : .vertical,
        placingOtherAfter: target.zone.isAfter
      )
    else {
      throw TerminalTabTransferError.missingLiveTree
    }
    let extractionPlan = try TerminalTabCollection.prepareExtraction(
      TerminalTabExtractionRequest(
        expectedTopologyRevision: request.expectedSourceRevision,
        itemIDs: [.tab(request.sourceTabID)]
      ),
      from: instances.source.tabCollection
    )
    let surfaceIDs = Set(sourceTree.leaves().map(\.id))
    try validateSurfaceOwnership(surfaceIDs, from: source, to: destination)
    return LiveTabMergePlan(
      destinationInstance: instances.destination,
      destinationTabID: destinationTabID,
      didMoveSelectedTab: instances.source.selectedTabID == request.sourceTabID,
      extractionPlan: extractionPlan,
      incomingFocusedSurfaceID: source.focusHistoryByTab[request.sourceTabID]?.current
        ?? sourceTree.leaves().first?.id,
      joinedTree: joinedTree,
      sourceInstance: instances.source,
      sourceTabID: request.sourceTabID,
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

  static func commitLiveTabMerge(
    _ plan: LiveTabMergePlan,
    from source: TerminalHostState,
    to destination: TerminalHostState
  ) throws {
    let deletedEmptyGroupIDs = try TerminalTabCollection.commitExtraction(
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
    plan.sourceInstance.collapsedTabGroupIDs.subtract(deletedEmptyGroupIDs)
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
  }

  private static func transferInstances(
    from source: TerminalHostState,
    sourceSpaceID: TerminalSpaceID,
    to destination: TerminalHostState,
    destinationSpaceID: TerminalSpaceID
  ) throws -> (source: TerminalSpaceInstance, destination: TerminalSpaceInstance) {
    source.warmInstanceForTabTransfer(for: sourceSpaceID)
    destination.warmInstanceForTabTransfer(for: destinationSpaceID)
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
  }

  private static func takeOwnership(
    tabIDs: [TerminalTabID],
    surfaceIDs: Set<UUID>,
    from source: TerminalHostState
  ) -> LiveTabOwnership {
    let ownership = LiveTabOwnership(
      agentCompletions: source.agentCompletionStore.take(surfaceIDs),
      agentDetections: source.agentDetectionStore.take(surfaceIDs),
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
    destination.agentCompletionStore.merge(ownership.agentCompletions)
    destination.agentDetectionStore.merge(ownership.agentDetections)
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
    let movedCollapsedGroupIDs = plan.sourceInstance.collapsedTabGroupIDs.intersection(plan.movedGroupIDs)
    plan.sourceInstance.collapsedTabGroupIDs.subtract(result.deletedEmptyGroupIDs)
    plan.sourceInstance.collapsedTabGroupIDs.subtract(plan.movedGroupIDs)
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
