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
    } else if itemIDs.count == 1, case .project(let projectID) = itemIDs[0] {
      source = .project(projectID)
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
    let invalidateLayout: () -> Void
    let updateHapticTarget: (TerminalSidebarSemanticPath?) -> Void
    let resetHapticTarget: () -> Void
  }

  var isActive: Bool { activeDrop != nil }

  private var activeDrop: TerminalSidebarExternalDrop?
  private let configuration: Configuration

  init(configuration: Configuration) {
    self.configuration = configuration
  }

  func update(_ info: any NSDraggingInfo, isPinnedTarget: Bool) -> NSDragOperation {
    guard
      let content = configuration.content(),
      let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard),
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
      path = .trailingRoot
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
    setTarget(payload: payload, sidebarPayload: sidebarPayload, resolution: resolution)
    guard resolution.plan != nil else { return [] }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  func matches(_ info: any NSDraggingInfo) -> Bool {
    guard
      let activeDrop,
      configuration.tabDragRegistry.resolve(info.draggingPasteboard) == activeDrop.payload
    else { return false }
    return true
  }

  func updateAfterAutoscroll(pointerY: CGFloat, isPinnedTarget: Bool) {
    guard
      let activeDrop,
      let content = configuration.content(),
      let sidebarPayload = activeDrop.payload.sidebarPayload(
        topologyStamp: activeDrop.topologyStamp
      )
    else { return }
    let path =
      isPinnedTarget
      ? TerminalSidebarSemanticPath.trailingRoot
      : configuration.collectionLayout.dropTargetMap.semanticTarget(at: pointerY)?.path
    let resolution = TerminalSidebarDropResolution(
      payload: sidebarPayload,
      path: path,
      outline: content.outline
    )
    setTarget(
      payload: activeDrop.payload,
      sidebarPayload: sidebarPayload,
      resolution: resolution
    )
  }

  func perform(_ info: any NSDraggingInfo) -> Bool {
    guard
      let activeDrop,
      configuration.tabDragRegistry.resolve(info.draggingPasteboard) == activeDrop.payload
    else { return false }
    defer { clear() }
    guard
      let outline = configuration.content()?.outline,
      let command = activeDrop.command(in: outline)
    else { return false }
    let result = configuration.tabDragRegistry.performTransfer(
      activeDrop.payload,
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
    let hadTarget = activeDrop != nil
    activeDrop = nil
    if hadTarget {
      configuration.collectionLayout.dragDropState = nil
      configuration.invalidateLayout()
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

  private func setTarget(
    payload: TerminalTabDragPayload,
    sidebarPayload: TerminalSidebarDragPayload,
    resolution: TerminalSidebarDropResolution
  ) {
    configuration.updateHapticTarget(resolution.path)
    guard let target = resolution.plan else {
      clearTarget()
      return
    }
    let next = TerminalSidebarExternalDrop(
      payload: payload,
      topologyStamp: sidebarPayload.topologyStamp,
      target: target
    )
    guard activeDrop != next else { return }
    activeDrop = next
    configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: entryIDs(for: sidebarPayload.source),
      target: target
    )
    configuration.invalidateLayout()
  }

  private func clearTarget() {
    guard activeDrop != nil else { return }
    activeDrop = nil
    configuration.collectionLayout.dragDropState = nil
    configuration.invalidateLayout()
  }

  private func entryIDs(for source: TerminalSidebarDragSource) -> [TerminalSidebarEntryID] {
    switch source {
    case .tabs(let tabIDs):
      tabIDs.map(TerminalSidebarEntryID.tab)
    case .project(let projectID):
      [.project(projectID)]
    }
  }
}
