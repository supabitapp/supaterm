import ComposableArchitecture

extension TerminalWindowRegistry {
  func transferTab(
    _ payload: TerminalTabDragPayload,
    to destination: TerminalTabDragRegistry.Destination
  ) -> TerminalTabTransferResult? {
    if let pane = payload.pane {
      return transferPane(pane, from: payload, to: destination)
    }
    return transferRootItems(payload, to: destination)
  }

  private func transferRootItems(
    _ payload: TerminalTabDragPayload,
    to destination: TerminalTabDragRegistry.Destination
  ) -> TerminalTabTransferResult? {
    guard
      let sourceEntry = entry(forWindowControllerID: payload.sourceWindowID),
      let destinationEntry = entry(forWindowControllerID: destination.windowControllerID)
    else { return nil }
    let request = TerminalTabTransferRequest(
      expectedSourceRevision: payload.sourceTopologyRevision,
      expectedDestinationRevision: destination.expectedTopologyRevision,
      itemIDs: payload.itemIDs,
      destination: destination.placement
    )
    guard
      let plan = try? TerminalHostState.prepareLiveTabTransfer(
        request,
        from: sourceEntry.terminal,
        sourceSpaceID: payload.sourceSpaceID,
        to: destinationEntry.terminal,
        destinationSpaceID: destination.spaceID
      )
    else { return nil }
    let hiddenSurfaceIDs = sourceEntry.store.terminal.hiddenAgentPanelSurfaceIDs.intersection(
      plan.surfaceIDs
    )
    let closesSourceWindow =
      sourceEntry.windowControllerID != destinationEntry.windowControllerID
      && sourceEntry.terminal.shouldCloseWindow(afterClosing: plan.tabIDs)
    guard
      let result = try? TerminalHostState.commitLiveTabTransfer(
        plan,
        from: sourceEntry.terminal,
        to: destinationEntry.terminal
      )
    else { return nil }
    if sourceEntry.windowControllerID != destinationEntry.windowControllerID {
      sourceEntry.store.send(
        .terminal(
          .hiddenAgentPanelsTransferred(remove: hiddenSurfaceIDs, insert: [])
        )
      )
      destinationEntry.store.send(
        .terminal(
          .hiddenAgentPanelsTransferred(remove: [], insert: hiddenSurfaceIDs)
        )
      )
    }
    if closesSourceWindow {
      sourceEntry.requestConfirmedWindowClose()
    }
    onChange()
    return result
  }

  private func transferPane(
    _ pane: TerminalTabDragPayload.Pane,
    from payload: TerminalTabDragPayload,
    to destination: TerminalTabDragRegistry.Destination
  ) -> TerminalTabTransferResult? {
    guard
      let sourceEntry = entry(forWindowControllerID: payload.sourceWindowID),
      let destinationEntry = entry(forWindowControllerID: destination.windowControllerID),
      let sourceTabID = sourceEntry.terminal.tabID(containing: pane.surfaceID),
      let sourceCollection = sourceEntry.terminal.spaceManager.tabCollection(
        for: payload.sourceSpaceID
      ),
      let destinationCollection = destinationEntry.terminal.spaceManager.tabCollection(
        for: destination.spaceID
      )
    else { return nil }

    if sourceCollection === destinationCollection {
      guard destination.expectedTopologyRevision == payload.sourceTopologyRevision else {
        return nil
      }
      guard
        (try? sourceEntry.terminal.movePaneToNewTab(
          pane.surfaceID,
          destinationTabID: pane.destinationTabID,
          at: destination.placement,
          expectedTopologyRevision: payload.sourceTopologyRevision
        )) != nil
      else { return nil }
      onChange()
      return TerminalTabTransferResult(
        tabIDs: [pane.destinationTabID],
        deletedEmptyGroupIDs: []
      )
    }

    guard
      destinationCollection.topologyRevision == destination.expectedTopologyRevision,
      let placement = sourceCollection.placement(after: sourceTabID),
      (try? sourceEntry.terminal.movePaneToNewTab(
        pane.surfaceID,
        destinationTabID: pane.destinationTabID,
        at: placement,
        expectedTopologyRevision: payload.sourceTopologyRevision
      )) != nil,
      let materializedPayload = TerminalTabDragPayload(
        operationID: payload.moveOperationID,
        sourceWindowID: payload.sourceWindowID,
        sourceSpaceID: payload.sourceSpaceID,
        sourceTopologyRevision: sourceCollection.topologyRevision,
        itemIDs: [.tab(pane.destinationTabID)]
      )
    else { return nil }
    return transferRootItems(materializedPayload, to: destination)
  }

  func splitTab(
    _ payload: TerminalTabDragPayload,
    to destination: TerminalTabDragRegistry.SplitDestination
  ) -> Bool {
    guard
      let sourceTabID = payload.singleTabID,
      let sourceEntry = entry(forWindowControllerID: payload.sourceWindowID),
      let destinationEntry = entry(forWindowControllerID: destination.windowControllerID)
    else { return false }
    if destination.sourceDisposition(for: payload) == .retained {
      let didSplit = sourceEntry.terminal.splitSelectedTabWithNewPane(
        sourceTabID,
        expectedTopologyRevision: payload.sourceTopologyRevision,
        keepingExistingContentIn: destination.zone,
        in: destination.spaceID
      )
      if didSplit { onChange() }
      return didSplit
    }
    guard
      let plan = try? TerminalHostState.prepareLiveTabMerge(
        TerminalHostState.LiveTabMergeRequest(
          expectedSourceRevision: payload.sourceTopologyRevision,
          sourceSpaceID: payload.sourceSpaceID,
          sourceTabID: sourceTabID
        ),
        from: sourceEntry.terminal,
        to: TerminalHostState.LiveTabSplitTarget(
          host: destinationEntry.terminal,
          zone: destination.zone,
          spaceID: destination.spaceID,
          tabID: destination.tabID
        )
      )
    else { return false }
    let hiddenSurfaceIDs = sourceEntry.store.terminal.hiddenAgentPanelSurfaceIDs.intersection(
      plan.surfaceIDs
    )
    let closesSourceWindow =
      sourceEntry.windowControllerID != destinationEntry.windowControllerID
      && sourceEntry.terminal.shouldCloseWindow(afterClosing: [sourceTabID])
    guard
      (try? TerminalHostState.commitLiveTabMerge(
        plan,
        from: sourceEntry.terminal,
        to: destinationEntry.terminal
      )) != nil
    else { return false }
    if sourceEntry.windowControllerID != destinationEntry.windowControllerID {
      sourceEntry.store.send(
        .terminal(.hiddenAgentPanelsTransferred(remove: hiddenSurfaceIDs, insert: []))
      )
      destinationEntry.store.send(
        .terminal(.hiddenAgentPanelsTransferred(remove: [], insert: hiddenSurfaceIDs))
      )
    }
    if closesSourceWindow {
      sourceEntry.requestConfirmedWindowClose()
    }
    onChange()
    return true
  }
}
