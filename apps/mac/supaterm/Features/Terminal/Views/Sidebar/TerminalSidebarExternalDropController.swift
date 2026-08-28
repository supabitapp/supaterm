import AppKit

struct TerminalSidebarExternalDrop: Equatable {
  let payload: TerminalTabDragPayload
  let topologyStamp: TerminalSidebarTopologyStamp
  let target: TerminalSidebarDropPlan

  func command(in outline: TerminalSidebarOutline) -> TerminalSidebarDropCommand? {
    guard topologyStamp == outline.topologyStamp else { return nil }
    guard let sidebarPayload = payload.sidebarPayload(topologyStamp: topologyStamp) else {
      return nil
    }
    return target.command(for: sidebarPayload)
  }
}

private struct TerminalSidebarExternalDropSession {
  let payload: TerminalTabDragPayload
  let topologyStamp: TerminalSidebarTopologyStamp
  let dropGapHeight: CGFloat?
  var dropTarget = TerminalSidebarDragTargetState.none

  func command(in outline: TerminalSidebarOutline) -> TerminalSidebarDropCommand? {
    guard case .accepted(let target) = dropTarget else { return nil }
    return TerminalSidebarExternalDrop(
      payload: payload,
      topologyStamp: topologyStamp,
      target: target
    ).command(in: outline)
  }
}

extension TerminalTabDragPayload {
  fileprivate func sidebarPayload(
    topologyStamp: TerminalSidebarTopologyStamp
  ) -> TerminalSidebarDragPayload? {
    let source: TerminalSidebarDragSource
    let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
      guard case .tab(let tabID) = itemID else { return nil }
      return tabID
    }
    if tabIDs.count == itemIDs.count {
      source = .tabs(tabIDs)
    } else if itemIDs.count == 1, case .group(let groupID) = itemIDs[0] {
      source = .group(groupID)
    } else {
      return nil
    }
    return TerminalSidebarDragPayload(
      operationID: moveOperationID,
      source: source,
      topologyStamp: topologyStamp
    )
  }
}

@MainActor
final class TerminalSidebarExternalDropController {
  struct Configuration {
    let collectionView: TerminalSidebarCollectionView
    let collectionLayout: TerminalSidebarCollectionLayout
    let tabDragRegistry: TerminalTabDragRegistry
    let windowControllerID: UUID
    let content: () -> TerminalSidebarDragController.Content?
    let updateAutoscroll: (CGFloat) -> Void
    let stopAutoscroll: () -> Void
    let invalidateLayout: () -> Void
    let updateHapticTarget: (TerminalSidebarSemanticPath?) -> Void
    let resetHapticTarget: () -> Void
    let didClear: () -> Void
  }

  var isActive: Bool { activeSession != nil }

  private var activeSession: TerminalSidebarExternalDropSession?
  private let configuration: Configuration

  init(configuration: Configuration) {
    self.configuration = configuration
  }

  func update(_ info: any NSDraggingInfo, isPinnedTarget: Bool) -> NSDragOperation {
    guard let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard) else {
      clear()
      return []
    }
    if let activeSession, activeSession.payload != payload {
      clear()
    }
    guard
      let content = configuration.content(),
      let sidebarPayload = sidebarPayload(payload, in: content.outline)
    else {
      clear()
      return []
    }
    let path: TerminalSidebarSemanticPath?
    if isPinnedTarget {
      configuration.updateAutoscroll(
        TerminalSidebarPinnedDropRouting.autoscrollPointerY(
          in: configuration.collectionView.visibleRect
        )
      )
      path = .rootBoundary(
        lane: .regular,
        index: content.outline.roots.count { !$0.isPinned }
      )
    } else {
      let location = configuration.collectionView.convert(info.draggingLocation, from: nil)
      configuration.updateAutoscroll(location.y)
      path = configuration.collectionLayout.dropTargetMap.semanticTarget(at: location.y)?.path
    }
    let resolution = TerminalSidebarDropResolution(
      payload: sidebarPayload,
      path: path,
      outline: content.outline
    )
    guard updateTarget(payload: payload, sidebarPayload: sidebarPayload, resolution: resolution)
    else {
      return []
    }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  func matches(_ info: any NSDraggingInfo) -> Bool {
    guard
      let activeSession,
      activeSession.dropTarget.acceptsDrop,
      configuration.tabDragRegistry.resolve(info.draggingPasteboard) == activeSession.payload
    else { return false }
    return true
  }

  func prepare(_ info: any NSDraggingInfo) -> Bool {
    guard matches(info) else { return false }
    configuration.stopAutoscroll()
    return true
  }

  func perform(_ info: any NSDraggingInfo) -> Bool {
    guard matches(info), let activeSession else { return false }
    defer { clear() }
    guard
      let outline = configuration.content()?.outline,
      let command = activeSession.command(in: outline)
    else { return false }
    let result = configuration.tabDragRegistry.performTransfer(
      activeSession.payload,
      to: TerminalTabDragRegistry.Destination(
        windowControllerID: configuration.windowControllerID,
        spaceID: command.topologyStamp.spaceID,
        expectedTopologyRevision: command.topologyStamp.revision,
        placement: command.destination
      )
    )
    return result != nil
  }

  func clear() {
    let hadSession = activeSession != nil
    configuration.stopAutoscroll()
    activeSession = nil
    if hadSession {
      configuration.collectionLayout.dragDropState = nil
      refreshLayout()
      configuration.didClear()
    }
    configuration.resetHapticTarget()
  }

  private func sidebarPayload(
    _ payload: TerminalTabDragPayload,
    in outline: TerminalSidebarOutline
  ) -> TerminalSidebarDragPayload? {
    guard let topologyStamp = outline.topologyStamp else { return nil }
    return payload.sidebarPayload(topologyStamp: topologyStamp)
  }

  func updateTarget(
    payload: TerminalTabDragPayload,
    sidebarPayload: TerminalSidebarDragPayload,
    resolution: TerminalSidebarDropResolution
  ) -> Bool {
    beginSession(payload: payload, sidebarPayload: sidebarPayload)
    guard var session = activeSession else { return false }

    let decision = session.dropTarget.transition(TerminalSidebarDragTargetEvent(resolution))
    activeSession = session
    switch decision.target {
    case .retain, .unchanged:
      break
    case .update(let target):
      configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
        source: sidebarPayload.source,
        draggingItemIDs: sidebarPayload.source.entryIDs,
        target: target,
        dropGapHeight: session.dropGapHeight
      )
      refreshLayout()
    case .clear:
      clear()
      return false
    }
    switch decision.haptic {
    case .none: break
    case .update(let path): configuration.updateHapticTarget(path)
    case .reset: configuration.resetHapticTarget()
    }
    return session.dropTarget.acceptsDrop
  }

  private func beginSession(
    payload: TerminalTabDragPayload,
    sidebarPayload: TerminalSidebarDragPayload
  ) {
    if let activeSession,
      activeSession.payload != payload
        || activeSession.topologyStamp != sidebarPayload.topologyStamp
    {
      clear()
    }
    guard activeSession == nil else { return }
    let session = TerminalSidebarExternalDropSession(
      payload: payload,
      topologyStamp: sidebarPayload.topologyStamp,
      dropGapHeight: configuration.tabDragRegistry.sidebarDropGapHeight(for: payload)
    )
    activeSession = session
    configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
      source: sidebarPayload.source,
      draggingItemIDs: sidebarPayload.source.entryIDs,
      target: nil,
      dropGapHeight: session.dropGapHeight
    )
    refreshLayout()
  }

  private func refreshLayout() {
    configuration.invalidateLayout()
    configuration.collectionLayout.prepare()
  }
}
