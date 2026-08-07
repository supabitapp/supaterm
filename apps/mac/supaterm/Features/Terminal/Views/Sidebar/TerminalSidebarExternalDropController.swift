import AppKit

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

  private struct ActiveDrop {
    let payload: TerminalTabDragPayload
    let sidebarPayload: TerminalSidebarDragPayload
    let target: TerminalSidebarDropPlan
  }

  var isActive: Bool { activeDrop != nil }

  private var activeDrop: ActiveDrop?
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
    let target: TerminalSidebarDropPlan?
    if isPinnedTarget {
      configuration.updateAutoscroll(
        TerminalSidebarPinnedDropRouting.autoscrollPointerY(
          in: configuration.collectionView.visibleRect
        )
      )
      target = TerminalSidebarPinnedDropRouting.target(
        payload: sidebarPayload,
        outline: content.outline
      )
    } else {
      let location = configuration.collectionView.convert(info.draggingLocation, from: nil)
      configuration.updateAutoscroll(location.y)
      target = configuration.collectionLayout.dropTargetMap.semanticTarget(at: location.y).flatMap {
        TerminalSidebarDropPlanner.plan(
          payload: sidebarPayload,
          path: $0.path,
          outline: content.outline
        )
      }
    }
    setTarget(payload: payload, sidebarPayload: sidebarPayload, target: target)
    guard target != nil else { return [] }
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
    guard let activeDrop, let content = configuration.content() else { return }
    let target =
      if isPinnedTarget {
        TerminalSidebarPinnedDropRouting.target(
          payload: activeDrop.sidebarPayload,
          outline: content.outline
        )
      } else {
        configuration.collectionLayout.dropTargetMap.semanticTarget(at: pointerY).flatMap {
          TerminalSidebarDropPlanner.plan(
            payload: activeDrop.sidebarPayload,
            path: $0.path,
            outline: content.outline
          )
        }
      }
    setTarget(
      payload: activeDrop.payload,
      sidebarPayload: activeDrop.sidebarPayload,
      target: target
    )
  }

  func perform(_ info: any NSDraggingInfo) -> Bool {
    guard
      let activeDrop,
      configuration.tabDragRegistry.resolve(info.draggingPasteboard) == activeDrop.payload,
      let command = activeDrop.target.command(for: activeDrop.sidebarPayload)
    else { return false }
    let result = configuration.tabDragRegistry.performTransfer(
      activeDrop.payload,
      to: TerminalTabDragRegistry.Destination(
        windowControllerID: configuration.windowControllerID,
        spaceID: command.topologyStamp.spaceID,
        placement: command.destination
      )
    )
    clear()
    return result != nil
  }

  func clear() {
    guard activeDrop != nil else { return }
    activeDrop = nil
    configuration.collectionLayout.dragDropState = nil
    configuration.resetHapticTarget()
    configuration.invalidateLayout()
  }

  private func sidebarPayload(
    _ payload: TerminalTabDragPayload,
    in outline: TerminalSidebarOutline
  ) -> TerminalSidebarDragPayload? {
    guard let topologyStamp = outline.topologyStamp else { return nil }
    let source: TerminalSidebarDragSource
    let tabIDs = payload.itemIDs.compactMap { itemID -> TerminalTabID? in
      guard case .tab(let tabID) = itemID else { return nil }
      return tabID
    }
    if tabIDs.count == payload.itemIDs.count {
      source = .tabs(tabIDs)
    } else if payload.itemIDs.count == 1, case .group(let groupID) = payload.itemIDs[0] {
      source = .group(groupID)
    } else {
      return nil
    }
    return TerminalSidebarDragPayload(
      operationID: payload.moveOperationID,
      source: source,
      topologyStamp: topologyStamp
    )
  }

  private func setTarget(
    payload: TerminalTabDragPayload,
    sidebarPayload: TerminalSidebarDragPayload,
    target: TerminalSidebarDropPlan?
  ) {
    guard let target else {
      clear()
      return
    }
    let next = ActiveDrop(
      payload: payload,
      sidebarPayload: sidebarPayload,
      target: target
    )
    guard activeDrop?.payload != payload || activeDrop?.target != target else { return }
    activeDrop = next
    configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: entryIDs(for: sidebarPayload.source),
      target: target
    )
    configuration.updateHapticTarget(target.path)
    configuration.invalidateLayout()
  }

  private func entryIDs(for source: TerminalSidebarDragSource) -> [TerminalSidebarEntryID] {
    switch source {
    case .tabs(let tabIDs):
      tabIDs.map(TerminalSidebarEntryID.tab)
    case .group(let groupID):
      [.group(groupID)]
    }
  }
}
