import AppKit

@MainActor
final class TerminalSidebarExternalDropController {
  struct Configuration {
    let collectionView: TerminalSidebarCollectionView
    let collectionLayout: TerminalSidebarCollectionLayout
    let tabDragRegistry: TerminalTabDragRegistry
    let windowControllerID: UUID
    let content: () -> TerminalSidebarDragController.Content?
    let updateAutoscroll: (CGFloat, TerminalSidebarAutoscrollTarget) -> Void
    let stopAutoscroll: () -> Void
    let invalidateLayout: () -> Void
    let updateHapticTarget: (TerminalSidebarSemanticPath?) -> Void
    let resetHapticTarget: () -> Void
    let didClear: () -> Void
  }

  var isActive: Bool { destinationModel.isActive }

  private let configuration: Configuration
  private var destinationModel: TerminalTabDropDestinationModel

  init(configuration: Configuration) {
    self.configuration = configuration
    destinationModel = TerminalTabDropDestinationModel(
      configuration: TerminalTabDropDestinationModel.Configuration(
        windowControllerID: configuration.windowControllerID,
        tabDragRegistry: configuration.tabDragRegistry,
        performLocalDrop: nil
      )
    )
  }

  func update(_ info: any NSDraggingInfo, isPinnedTarget: Bool) -> NSDragOperation {
    guard let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard) else {
      clear()
      return []
    }
    guard let content = configuration.content() else {
      clear()
      return []
    }
    let path: TerminalSidebarSemanticPath?
    if isPinnedTarget {
      configuration.updateAutoscroll(
        TerminalSidebarPinnedDropRouting.autoscrollPointerY(
          in: configuration.collectionView.visibleRect
        ),
        .pinnedControl
      )
      path = .rootBoundary(
        lane: .regular,
        index: content.outline.roots.count { !$0.isPinned }
      )
    } else {
      let location = configuration.collectionView.convert(info.draggingLocation, from: nil)
      configuration.updateAutoscroll(location.y, .collection)
      path = configuration.collectionLayout.dropTargetMap.semanticTarget(at: location.y)?.path
    }
    guard updateTarget(payload: payload, path: path, outline: content.outline) else {
      return []
    }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  func updateAfterAutoscroll(
    pointerY: CGFloat,
    target: TerminalSidebarAutoscrollTarget
  ) {
    guard
      let payload = destinationModel.activePayload,
      let content = configuration.content()
    else { return }
    let path =
      switch target {
      case .collection:
        configuration.collectionLayout.dropTargetMap.semanticTarget(at: pointerY)?.path
      case .pinnedControl:
        TerminalSidebarSemanticPath.rootBoundary(
          lane: .regular,
          index: content.outline.roots.count { !$0.isPinned }
        )
      }
    _ = updateTarget(
      payload: payload,
      path: path,
      outline: content.outline
    )
  }

  func matches(_ info: any NSDraggingInfo) -> Bool {
    guard let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard) else {
      return false
    }
    return destinationModel.accepts(payload)
  }

  func prepare(_ info: any NSDraggingInfo) -> Bool {
    guard
      let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard),
      destinationModel.prepare(payload)
    else { return false }
    configuration.stopAutoscroll()
    return true
  }

  func perform(_ info: any NSDraggingInfo) -> Bool {
    guard
      let payload = configuration.tabDragRegistry.resolve(info.draggingPasteboard),
      destinationModel.accepts(payload)
    else { return false }
    defer { clear() }
    guard let outline = configuration.content()?.outline else { return false }
    return destinationModel.perform(payload, in: outline)
  }

  func clear() {
    configuration.stopAutoscroll()
    let clearedSession = destinationModel.clear()
    if clearedSession { clearPresentation() }
    configuration.resetHapticTarget()
  }

  func updateTarget(
    payload: TerminalTabDragPayload,
    path: TerminalSidebarSemanticPath?,
    outline: TerminalSidebarOutline
  ) -> Bool {
    guard
      let update = destinationModel.update(
        payload,
        in: outline,
        path: { _ in path }
      )
    else {
      clear()
      return false
    }
    if update.replacedSession {
      configuration.stopAutoscroll()
      clearPresentation()
      configuration.resetHapticTarget()
    }
    if update.beganSession {
      configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
        source: update.sidebarPayload.source,
        draggingItemIDs: update.sidebarPayload.source.entryIDs,
        target: nil,
        dropGapHeight: configuration.tabDragRegistry.sidebarDropGapHeight(for: payload)
      )
      refreshLayout()
    }
    guard let decision = update.decision else { return false }
    switch decision.target {
    case .retain, .unchanged:
      break
    case .update(let target):
      configuration.collectionLayout.dragDropState = TerminalSidebarDragDropState(
        source: update.sidebarPayload.source,
        draggingItemIDs: update.sidebarPayload.source.entryIDs,
        target: target,
        dropGapHeight: configuration.tabDragRegistry.sidebarDropGapHeight(for: payload)
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
    return update.acceptsDrop
  }

  private func clearPresentation() {
    configuration.collectionLayout.dragDropState = nil
    refreshLayout()
    configuration.didClear()
  }

  private func refreshLayout() {
    configuration.invalidateLayout()
    configuration.collectionLayout.prepare()
  }
}
