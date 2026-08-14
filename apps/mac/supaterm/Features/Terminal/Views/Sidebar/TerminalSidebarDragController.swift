import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
final class TerminalSidebarDragController {
  typealias DropHandoffCompletion = @MainActor @Sendable () -> Void

  struct Content {
    let outline: TerminalSidebarOutline
    let selectedTabID: TerminalTabID?
    let rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation]
    let context: TerminalSidebarRowContext
    let motionPolicy: TerminalSidebarMotionPolicy
    let canBeginDrag: Bool
    let swipe: SpaceSwipeController?
    let groupBackgroundViews: [TerminalTabGroupID: TerminalSidebarGroupBackgroundView]
  }

  struct Host {
    let content: () -> Content?
    let indexPath: (TerminalSidebarEntryID) -> IndexPath?
    let invalidateLayout: () -> Void
    let rebindRows: (Set<TerminalSidebarEntryID>) -> Void
    let didBegin: () -> Void
    let didFinish: () -> Void
    let completeDropHandoff:
      (
        TerminalSidebarDropHandoff,
        @escaping DropHandoffCompletion
      ) -> Void
    let setHoveredGroupID: (TerminalTabGroupID?) -> Void
  }

  var performDrop: ((TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?)?

  private let collectionView: TerminalSidebarCollectionView
  private let collectionLayout: TerminalSidebarCollectionLayout
  private let layoutAnimator: TerminalSidebarLayoutAnimator
  private let scrollView: TerminalSidebarScrollView
  private let sourceSurfaceView: NSView
  private let sourceWindowID: UUID
  private let tabDragRegistry: TerminalTabDragRegistry
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  private let host: Host
  private var pendingDrag: TerminalSidebarPendingDrag?
  private var activeDrag: TerminalSidebarActiveDrag?
  private var isDraggingOverPinnedControl = false

  private lazy var autoscrollController = TerminalSidebarDragAutoscrollController(
    collectionView: collectionView,
    scrollView: scrollView,
    onScroll: { [weak self] pointerY in self?.updateDropTargetAfterAutoscroll(pointerY: pointerY) }
  )
  private lazy var dragPresentation = TerminalSidebarDragPresentation(
    collectionView: collectionView
  )
  private lazy var nativeDragSession = TerminalSidebarNativeDragSession(
    collectionView: collectionView,
    sourceSurfaceView: sourceSurfaceView,
    registry: tabDragRegistry,
    captureClient: .live,
    captureRequest: captureRequest
  )
  private lazy var externalDropController = TerminalSidebarExternalDropController(
    configuration: TerminalSidebarExternalDropController.Configuration(
      collectionView: collectionView,
      collectionLayout: collectionLayout,
      tabDragRegistry: tabDragRegistry,
      windowControllerID: sourceWindowID,
      content: { [weak self] in self?.host.content() },
      updateAutoscroll: { [weak self] in self?.autoscrollController.update(pointerY: $0) },
      invalidateLayout: { [weak self] in self?.host.invalidateLayout() },
      updateHapticTarget: { [weak self] in self?.dragPresentation.updateHapticTarget($0) },
      resetHapticTarget: { [weak self] in self?.dragPresentation.resetHapticTarget() }
    )
  )
  lazy var pinnedControl = TerminalSidebarPinnedControlHost(
    draggingUpdated: { [weak self] info in
      self?.draggingUpdatedAtPinnedControl(info) ?? []
    },
    draggingExited: { [weak self] in self?.draggingExited() },
    draggingEnded: { [weak self] in
      self?.destinationDraggingEnded()
    },
    prepareForDragOperation: { [weak self] info in
      self?.prepareForDragOperation(info) == true
    },
    performDragOperation: { [weak self] info in
      self?.performDragOperation(info) == true
    }
  )

  init(
    collectionView: TerminalSidebarCollectionView,
    collectionLayout: TerminalSidebarCollectionLayout,
    layoutAnimator: TerminalSidebarLayoutAnimator,
    scrollView: TerminalSidebarScrollView,
    sourceSurfaceView: NSView,
    sourceWindowID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?,
    host: Host
  ) {
    self.collectionView = collectionView
    self.collectionLayout = collectionLayout
    self.layoutAnimator = layoutAnimator
    self.scrollView = scrollView
    self.sourceSurfaceView = sourceSurfaceView
    self.sourceWindowID = sourceWindowID
    self.tabDragRegistry = tabDragRegistry
    self.captureRequest = captureRequest
    self.host = host
    collectionView.onRowMouseDown = { [weak self] entryID, event in
      self?.rowMouseDown(entryID: entryID, event: event) == true
    }
    collectionView.onRowMouseDragged = { [weak self] entryID, event in
      self?.rowMouseDragged(entryID: entryID, event: event) == true
    }
    collectionView.onRowMouseUp = { [weak self] entryID, event in
      self?.rowMouseUp(entryID: entryID, event: event) == true
    }
    collectionView.onDraggingUpdated = { [weak self] info in
      self?.draggingUpdated(info) ?? []
    }
    collectionView.onDraggingExited = { [weak self] in self?.draggingExited() }
    collectionView.onDraggingEnded = { [weak self] in
      self?.destinationDraggingEnded()
    }
    collectionView.onPrepareForDragOperation = { [weak self] info in
      self?.prepareForDragOperation(info) == true
    }
    collectionView.onPerformDragOperation = { [weak self] info in
      self?.performDragOperation(info) == true
    }
    collectionView.onDraggingSessionMoved = { [weak self] point in
      self?.draggingSessionMoved(to: point)
    }
    collectionView.onDraggingSessionEnded = { [weak self] _, operation in
      self?.nativeDraggingEnded(source: "source", operation: operation)
    }
  }

  var isActive: Bool { activeDrag != nil }
  var liftedGroupID: TerminalTabGroupID? { dragPresentation.groupID }

  func disposition(
    for incoming: TerminalSidebarOutline,
    applied: TerminalSidebarOutline,
    canApplyUpdate: Bool
  ) -> TerminalSidebarDragOutlineDisposition {
    guard let activeDrag else { return .inactive }
    if activeDrag.externalCompletion.sourceDisposition != nil { return .queue }
    guard canApplyUpdate else { return .queue }
    switch activeDrag.coordinator.phase {
    case .tracking:
      return TerminalSidebarDragOutlineDisposition.tracking(
        incoming: incoming,
        applied: applied,
        sourceTopologyStamp: activeDrag.payload.topologyStamp
      )
    case .frozen, .awaitingNativeEnd:
      return .queue
    case .cancelled, .settling, .finished:
      return .queue
    }
  }

  func cancelTopologyChange(reason: String) {
    guard var activeDrag else { return }
    activeDrag.coordinator.cancel(topologyChanged: true)
    activeDrag.target = nil
    self.activeDrag = activeDrag
    logCancel(reason: reason, operationID: activeDrag.payload.operationID)
    autoscrollController.stop()
    layoutAnimator.finish()
    collectionLayout.dragDropState = nil
    externalDropController.clear()
    isDraggingOverPinnedControl = false
    dragPresentation.resetHapticTarget()
    host.invalidateLayout()
  }

  func setLiveScrolling(_ value: Bool) {
    autoscrollController.setLiveScrolling(value)
  }

  private func rowMouseDown(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    guard activeDrag == nil else { return false }
    nativeDragSession.cancelSourceCapture()
    guard let content = host.content() else { return false }
    let consumesClick = if case .tab = entryID { true } else { false }
    if case .tab(let tabID) = entryID,
      TerminalSidebarOptionTabClick.accepts(
        modifiers: event.modifierFlags,
        clickCount: event.clickCount
      )
    {
      guard content.canBeginDrag, content.swipe?.isTracking != true else { return true }
      if content.context.terminal.mergeTabIntoSelectedTab(tabID) {
        content.context.tabSelectionState.clear()
      }
      return true
    }
    guard content.canBeginDrag else {
      selectPressedTab(entryID, modifiers: event.modifierFlags, content: content)
      return consumesClick
    }
    guard let payload = content.outline.dragPayload(for: entryID) else {
      selectPressedTab(entryID, modifiers: event.modifierFlags, content: content)
      return consumesClick
    }
    if case .group(let groupID) = payload.source, content.context.renameState.groupID == groupID {
      return consumesClick
    }
    guard
      let indexPath = host.indexPath(entryID),
      let attributes = collectionLayout.layoutAttributesForItem(at: indexPath)
    else {
      selectPressedTab(entryID, modifiers: event.modifierFlags, content: content)
      return consumesClick
    }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    guard attributes.frame.contains(location) else {
      selectPressedTab(entryID, modifiers: event.modifierFlags, content: content)
      return consumesClick
    }
    let selection = tabPressSelection(
      entryID: entryID,
      modifiers: event.modifierFlags,
      content: content
    )
    pendingDrag = TerminalSidebarPendingDrag(
      entryID: entryID,
      origin: location,
      selectedTabIDs: selection.selectedTabIDs,
      defersSelection: selection.defersSelection,
      selectionHandoff: TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: entryID,
        primaryTabID: content.selectedTabID,
        modifiers: event.modifierFlags,
        selectedTabIDs: selection.selectedTabIDs
      )
    )
    nativeDragSession.prepareSourceCapture()
    switch entryID {
    case .group:
      return true
    case .tab:
      return true
    case .pinDivider, .newTab:
      return false
    }
  }

  private func rowMouseDragged(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    guard var pendingDrag, pendingDrag.entryID == entryID else { return false }
    guard !pendingDrag.isActivationFailed else { return false }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    let decision =
      if let indexPath = host.indexPath(entryID),
        let attributes = collectionLayout.layoutAttributesForItem(at: indexPath)
      {
        TerminalSidebarDragActivation.decision(
          origin: pendingDrag.origin,
          location: location,
          sourceFrame: attributes.frame
        )
      } else {
        TerminalSidebarDragActivation.Decision.failed
      }
    switch decision {
    case .pending:
      return false
    case .failed:
      pendingDrag.isActivationFailed = true
      self.pendingDrag = pendingDrag
      nativeDragSession.cancelSourceCapture()
      return false
    case .begin:
      self.pendingDrag = nil
      guard let content = host.content() else {
        nativeDragSession.cancelSourceCapture()
        return true
      }
      let beganDragging = beginDragging(
        pendingDrag: pendingDrag,
        event: event,
        content: content
      )
      guard !beganDragging else { return true }
      nativeDragSession.cancelSourceCapture()
      resolveDeferredSelection(pendingDrag, content: content)
      return true
    }
  }

  private func rowMouseUp(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    let consumes = activeDrag != nil && pendingDrag?.entryID == nil
    if activeDrag == nil {
      nativeDragSession.cancelSourceCapture()
    }
    guard let pendingDrag, pendingDrag.entryID == entryID else { return consumes }
    self.pendingDrag = nil
    guard let content = host.content() else { return consumes }
    switch entryID {
    case .group(let groupID):
      let location = collectionView.convert(event.locationInWindow, from: nil)
      let frame = host.indexPath(entryID).flatMap {
        collectionLayout.layoutAttributesForItem(at: $0)?.frame
      }
      guard TerminalSidebarGroupClick.acceptsRelease(location, frame: frame) else { return true }
      content.context.actions.toggleGroupCollapsed(groupID)
      return true
    case .tab:
      resolveDeferredSelection(pendingDrag, content: content)
      return true
    case .pinDivider, .newTab:
      return consumes
    }
  }

  private func selectTab(
    _ tabID: TerminalTabID,
    modifiers: NSEvent.ModifierFlags,
    content: Content
  ) {
    let modifiers = modifiers.intersection([.command, .shift])
    guard !modifiers.isEmpty else {
      content.context.tabSelectionState.clear()
      content.context.terminal.selectTab(tabID)
      return
    }
    applyModifiedSelection(tabID: tabID, modifiers: modifiers, content: content)
  }

  private func selectPressedTab(
    _ entryID: TerminalSidebarEntryID,
    modifiers: NSEvent.ModifierFlags,
    content: Content
  ) {
    guard case .tab(let tabID) = entryID else { return }
    selectTab(tabID, modifiers: modifiers, content: content)
  }

  private func tabPressSelection(
    entryID: TerminalSidebarEntryID,
    modifiers: NSEvent.ModifierFlags,
    content: Content
  ) -> (selectedTabIDs: [TerminalTabID], defersSelection: Bool) {
    guard case .tab(let tabID) = entryID else { return ([], false) }
    let selectedTabIDs = content.context.tabSelectionState.orderedTabIDs(
      primaryTabID: content.selectedTabID,
      outline: content.outline
    )
    switch TerminalSidebarTabPressDecision.resolve(
      tabID: tabID,
      modifiers: modifiers,
      selectedTabIDs: selectedTabIDs
    ) {
    case .applySelection:
      selectTab(tabID, modifiers: modifiers, content: content)
      return (
        content.context.tabSelectionState.contextualTabIDs(
          for: tabID,
          primaryTabID: content.selectedTabID,
          outline: content.outline
        ),
        false
      )
    case .deferSelection(let selectedTabIDs):
      return (selectedTabIDs, true)
    }
  }

  private func resolveDeferredSelection(
    _ pendingDrag: TerminalSidebarPendingDrag,
    content: Content
  ) {
    guard pendingDrag.defersSelection, case .tab(let tabID) = pendingDrag.entryID else { return }
    selectTab(tabID, modifiers: [], content: content)
  }

  private func applyModifiedSelection(
    tabID: TerminalTabID,
    modifiers: NSEvent.ModifierFlags,
    content: Content
  ) {
    guard let selectedTabID = content.selectedTabID else {
      content.context.tabSelectionState.clear()
      content.context.terminal.selectTab(tabID)
      return
    }
    if modifiers.contains(.shift) {
      content.context.tabSelectionState.selectRange(
        to: tabID,
        primaryTabID: selectedTabID,
        outline: content.outline,
        additive: modifiers.contains(.command)
      )
    } else {
      content.context.tabSelectionState.toggle(tabID, primaryTabID: selectedTabID)
    }
  }

  private func beginDragging(
    pendingDrag: TerminalSidebarPendingDrag,
    event: NSEvent,
    content: Content
  ) -> Bool {
    guard content.canBeginDrag, content.swipe?.isTracking != true else { return false }
    let pointer = collectionView.convert(event.locationInWindow, from: nil)
    if case .group = pendingDrag.entryID {
      content.context.tabSelectionState.clear()
    }
    guard
      let payload = content.outline.dragPayload(
        for: pendingDrag.entryID,
        selectedTabIDs: pendingDrag.selectedTabIDs
      )
    else { return false }
    let liftedEntryIDs = content.outline.liftedEntryIDs(for: payload.source)
    host.setHoveredGroupID(nil)
    content.context.groupHeaderHoverState.set(nil)
    guard
      let geometry = TerminalSidebarDragSourceGeometry.resolve(
        payload: payload,
        liftedEntryIDs: liftedEntryIDs,
        anchorEntryID: pendingDrag.entryID,
        plan: collectionLayout.plan
      ),
      let liftedRows = liftRows(liftedEntryIDs, itemByID: geometry.itemByID, content: content)
    else { return false }
    guard
      let tabDragPayload = TerminalTabDragPayload(
        operationID: payload.operationID,
        sourceWindowID: sourceWindowID,
        sourceSpaceID: payload.topologyStamp.spaceID,
        sourceTopologyRevision: payload.topologyStamp.revision,
        itemIDs: payload.source.itemIDs
      ),
      nativeDragSession.register(
        tabDragPayload,
        splitDestinationEntryAction: makeSplitDestinationSelectionHandoff(
          pendingDrag.selectionHandoff,
          draggedTabID: tabDragPayload.singleTabID
        ),
        didTransfer: { [weak self] operationID, sourceDisposition in
          self?.externalTransferDidComplete(
            operationID,
            sourceDisposition: sourceDisposition
          )
        }
      )
    else {
      liftedRows.forEach { $0.restore() }
      return false
    }
    activeDrag = TerminalSidebarActiveDrag(
      payload: payload,
      liftedEntryIDs: liftedEntryIDs,
      coordinator: TerminalSidebarDragCoordinator(payload: payload),
      target: nil
    )
    host.didBegin()
    content.swipe?.isRowDragActive = true
    let screenPoint = screenPoint(for: event)
    let presentationState = nativeDragSession.move(to: screenPoint)
    collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: liftedEntryIDs,
      target: nil
    )
    dragPresentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: liftedRows,
        groupBackground: liftedGroupBackground(for: payload.source, content: content),
        fanAnchorIndex: geometry.fanAnchorIndex,
        sourceFrame: geometry.frame,
        hotspot: CGPoint(x: pointer.x - geometry.frame.minX, y: pointer.y - geometry.frame.minY),
        screenPoint: screenPoint,
        timestamp: event.timestamp
      ),
      motionPolicy: content.motionPolicy
    )
    dragPresentation.move(to: screenPoint, presentationState: presentationState)
    host.invalidateLayout()
    logDrag(
      "sidebar.drag.activation",
      fields: TerminalSidebarDragLog.activeFields(payload) + [
        "sourceMinY=\(TerminalSidebarDragLog.coordinate(geometry.frame.minY))",
        "sourceMaxY=\(TerminalSidebarDragLog.coordinate(geometry.frame.maxY))",
      ]
    )
    collectionView.finishTrackingRowPointer(entryID: pendingDrag.entryID)
    nativeDragSession.beginDraggingSession(
      payload: tabDragPayload,
      frame: geometry.frame,
      event: event
    )
    return true
  }

  private func liftRows(
    _ entryIDs: [TerminalSidebarEntryID],
    itemByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item],
    content: Content
  ) -> [TerminalSidebarLiftedRow]? {
    var liftedRows: [TerminalSidebarLiftedRow] = []
    for entryID in entryIDs {
      guard let sourceItem = itemByID[entryID] else {
        liftedRows.forEach { $0.restore() }
        return nil
      }
      let selectedSurface = liftedSelectedSurface(
        for: entryID,
        sourceFrame: sourceItem.frame,
        content: content
      )
      if let indexPath = host.indexPath(entryID),
        let item = collectionView.item(at: indexPath) as? TerminalSidebarCollectionItem,
        let lifted = item.liftHostedView(
          sourceFrame: sourceItem.frame,
          selectedSurface: selectedSurface
        )
      {
        liftedRows.append(lifted)
        continue
      }
      guard let presentation = content.rows[entryID] else {
        liftedRows.forEach { $0.restore() }
        return nil
      }
      let hostedView = NSHostingView(
        rootView: TerminalSidebarHostedRow(
          presentation: presentation,
          context: content.context
        )
      )
      hostedView.frame.size = sourceItem.frame.size
      liftedRows.append(
        TerminalSidebarLiftedRow(
          hostedView: hostedView,
          sourceFrame: sourceItem.frame,
          selectedSurface: selectedSurface,
          restore: {}
        )
      )
    }
    return liftedRows
  }

  private func liftedSelectedSurface(
    for entryID: TerminalSidebarEntryID,
    sourceFrame: CGRect,
    content: Content
  ) -> TerminalSidebarLiftedSelectionSurface? {
    guard
      case .tab(let tabID) = entryID,
      tabID == content.selectedTabID,
      case .tab(let presentation) = content.rows[entryID]
    else { return nil }
    let view = TerminalSidebarSelectionGlowView()
    view.update(
      surfaceFrame: TerminalSidebarLayout.tabSurfaceFrame(
        in: sourceFrame,
        isGrouped: presentation.groupID != nil
      ),
      style: .resolve(palette: content.context.palette),
      alpha: 1,
      fadesAtContentTop: false
    )
    return TerminalSidebarLiftedSelectionSurface(view: view)
  }

  private func liftedGroupBackground(
    for source: TerminalSidebarDragSource,
    content: Content
  ) -> TerminalSidebarLiftedGroupBackground? {
    guard
      case .group(let groupID) = source,
      let view = content.groupBackgroundViews[groupID]
    else {
      return nil
    }
    return TerminalSidebarLiftedGroupBackground(id: groupID, view: view, sourceFrame: view.frame)
  }

  private func draggingUpdated(_ info: any NSDraggingInfo) -> NSDragOperation {
    if info.draggingSource as AnyObject? !== collectionView {
      return draggingUpdatedFromExternalSource(info)
    }
    guard
      let activeDrag,
      case .tracking = activeDrag.coordinator.phase,
      let content = host.content()
    else { return [] }
    isDraggingOverPinnedControl = false
    let location = collectionView.convert(info.draggingLocation, from: nil)
    autoscrollController.update(pointerY: location.y)
    updateDropTarget(pointerY: location.y, content: content)
    guard self.activeDrag?.target != nil else { return [] }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  private func draggingUpdatedAtPinnedControl(_ info: any NSDraggingInfo) -> NSDragOperation {
    if info.draggingSource as AnyObject? !== collectionView {
      return draggingUpdatedAtPinnedControlFromExternalSource(info)
    }
    guard
      let activeDrag,
      case .tracking = activeDrag.coordinator.phase,
      let content = host.content()
    else { return [] }
    isDraggingOverPinnedControl = true
    autoscrollController.update(
      pointerY: TerminalSidebarPinnedDropRouting.autoscrollPointerY(
        in: collectionView.visibleRect
      )
    )
    updatePinnedNewTabDropTarget(content: content)
    guard activeDrag.target != nil else { return [] }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  private func draggingUpdatedFromExternalSource(
    _ info: any NSDraggingInfo
  ) -> NSDragOperation {
    isDraggingOverPinnedControl = false
    return externalDropController.update(info, isPinnedTarget: false)
  }

  private func draggingUpdatedAtPinnedControlFromExternalSource(
    _ info: any NSDraggingInfo
  ) -> NSDragOperation {
    isDraggingOverPinnedControl = true
    return externalDropController.update(info, isPinnedTarget: true)
  }

  private func externalTransferDidComplete(
    _ operationID: TerminalTabMoveOperationID,
    sourceDisposition: TerminalTabDragRegistry.SourceDisposition
  ) {
    guard var activeDrag else { return }
    guard
      activeDrag.completeExternal(
        operationID: operationID,
        sourceDisposition: sourceDisposition
      )
    else { return }
    self.activeDrag = activeDrag
  }

  private func draggingExited() {
    isDraggingOverPinnedControl = false
    autoscrollController.stop()
    if externalDropController.isActive {
      externalDropController.clear()
      return
    }
    guard
      let activeDrag,
      case .tracking = activeDrag.coordinator.phase,
      let content = host.content()
    else { return }
    setDropTarget(
      TerminalSidebarDropResolution(
        payload: activeDrag.payload,
        path: nil,
        outline: content.outline
      ),
      pointerY: nil,
      content: content
    )
  }

  private func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    if info.draggingSource as AnyObject? !== collectionView {
      return externalDropController.matches(info)
    }
    guard
      var activeDrag,
      let target = activeDrag.target,
      activeDrag.coordinator.freeze(target) != nil
    else { return false }
    self.activeDrag = activeDrag
    autoscrollController.stop()
    logDrag(
      "sidebar.drag.freeze",
      fields: TerminalSidebarDragLog.activeFields(activeDrag.payload)
        + TerminalSidebarDragLog.targetFields(target)
    )
    return true
  }

  private func performDragOperation(_ info: any NSDraggingInfo) -> Bool {
    if info.draggingSource as AnyObject? !== collectionView {
      return externalDropController.perform(info)
    }
    guard
      var activeDrag,
      let command = activeDrag.coordinator.command,
      let plan = activeDrag.coordinator.frozenPlan
    else { return false }
    logDrag(
      "sidebar.drag.transactionRequest",
      fields: TerminalSidebarDragLog.activeFields(activeDrag.payload)
        + TerminalSidebarDragLog.targetFields(plan)
    )
    let receipt = performDrop?(command)
    guard activeDrag.coordinator.complete(receipt) else { return false }
    self.activeDrag = activeDrag
    if let receipt {
      logDrag(
        "sidebar.drag.receiptSuccess",
        fields: TerminalSidebarDragLog.activeFields(activeDrag.payload) + [
          "receiptRevision=\(receipt.topologyRevision)",
          "deletedGroupCount=\(receipt.deletedEmptyGroupIDs.count)",
        ]
      )
    } else {
      logDrag(
        "sidebar.drag.receiptRejection",
        fields: TerminalSidebarDragLog.activeFields(activeDrag.payload)
          + ["reason=transactionRejected"]
      )
    }
    return receipt != nil
  }

  private func draggingSessionMoved(to screenPoint: NSPoint) {
    guard let activeDrag else { return }
    let presentationState = nativeDragSession.move(to: screenPoint)
    switch activeDrag.coordinator.phase {
    case .cancelled, .settling, .finished: return
    case .tracking, .frozen, .awaitingNativeEnd: break
    }
    dragPresentation.move(to: screenPoint, presentationState: presentationState)
  }

  private func makeSplitDestinationSelectionHandoff(
    _ handoff: TerminalSidebarTabDragSelectionHandoff?,
    draggedTabID: TerminalTabID?
  ) -> (() -> Void)? {
    guard let handoff, let draggedTabID else { return nil }
    return { [weak self] in
      guard
        let self,
        let content = self.host.content(),
        let tabID = handoff.tabIDToRestore(
          draggedTabID: draggedTabID,
          liveSelectedTabID: content.context.terminal.selectedTabID
        )
      else { return }
      self.selectTab(tabID, modifiers: [], content: content)
    }
  }

  private func nativeDraggingEnded(source: String, operation: NSDragOperation?) {
    pendingDrag = nil
    isDraggingOverPinnedControl = false
    autoscrollController.stop()
    externalDropController.clear()
    guard var activeDrag else { return }
    logDrag(
      "sidebar.drag.nativeEnd",
      fields: TerminalSidebarDragLog.operationFields(activeDrag.payload.operationID) + [
        "source=\(source)",
        "operation=\(String(describing: operation))",
        "phase=\(String(describing: activeDrag.coordinator.phase))",
      ]
    )
    if activeDrag.externalCompletion.sourceDisposition != nil,
      case .tracking = activeDrag.coordinator.phase
    {
      self.activeDrag = activeDrag
      finishDragging()
      return
    }
    let previousPhase = activeDrag.coordinator.phase
    let settlement = activeDrag.coordinator.nativeEnded()
    self.activeDrag = activeDrag
    switch previousPhase {
    case .tracking, .frozen:
      logCancel(
        reason: "nativeEndedWithoutReceipt.\(source)",
        operationID: activeDrag.payload.operationID
      )
    case .awaitingNativeEnd(_, nil):
      logCancel(
        reason: "transactionRejected.\(source)",
        operationID: activeDrag.payload.operationID
      )
    case .awaitingNativeEnd, .cancelled, .settling, .finished:
      break
    }
    if let settlement {
      guard let content = host.content() else {
        finishDragging()
        return
      }
      beginSettlement(settlement, content: content)
    }
  }

  private func destinationDraggingEnded() {
    isDraggingOverPinnedControl = false
    autoscrollController.stop()
    externalDropController.clear()
  }

  private func updateDropTarget(pointerY: CGFloat, content: Content) {
    guard let activeDrag, case .tracking = activeDrag.coordinator.phase else { return }
    let semanticTarget = collectionLayout.dropTargetMap.semanticTarget(at: pointerY)
    let resolution = TerminalSidebarDropResolution(
      payload: activeDrag.payload,
      path: semanticTarget?.path,
      outline: content.outline
    )
    setDropTarget(resolution, pointerY: pointerY, content: content)
  }

  private func updateDropTargetAfterAutoscroll(pointerY: CGFloat) {
    guard let content = host.content() else { return }
    if externalDropController.isActive {
      externalDropController.updateAfterAutoscroll(
        pointerY: pointerY,
        isPinnedTarget: isDraggingOverPinnedControl
      )
      return
    }
    if isDraggingOverPinnedControl {
      updatePinnedNewTabDropTarget(content: content)
    } else {
      updateDropTarget(pointerY: pointerY, content: content)
    }
  }

  private func updatePinnedNewTabDropTarget(content: Content) {
    guard let activeDrag, case .tracking = activeDrag.coordinator.phase else { return }
    let resolution = TerminalSidebarDropResolution(
      payload: activeDrag.payload,
      path: .trailingRoot,
      outline: content.outline
    )
    setDropTarget(resolution, pointerY: nil, content: content)
  }

  private func setDropTarget(
    _ resolution: TerminalSidebarDropResolution,
    pointerY: CGFloat?,
    content: Content
  ) {
    guard var activeDrag else { return }
    let target = resolution.plan
    let changed = activeDrag.target != target
    if changed {
      activeDrag.target = target
      self.activeDrag = activeDrag
      logDrag(
        "sidebar.drag.targetTransition",
        fields: TerminalSidebarDragLog.activeFields(activeDrag.payload)
          + ["pointerY=\(pointerY.map(TerminalSidebarDragLog.coordinate) ?? "nil")"]
          + TerminalSidebarDragLog.targetFields(resolution)
      )
      layoutAnimator.animate(enabled: content.motionPolicy.targetInterpolation) {
        collectionLayout.dragDropState = TerminalSidebarDragDropState(
          draggingItemIDs: activeDrag.liftedEntryIDs,
          target: target
        )
      }
    }
    dragPresentation.updateHapticTarget(resolution.path)
    if changed { host.invalidateLayout() }
  }

  private func beginSettlement(
    _ settlement: TerminalSidebarDragCoordinator.Settlement,
    content: Content
  ) {
    guard let activeDrag else { return }
    switch settlement {
    case .accepted(let receipt):
      settleDragging(receipt: receipt, content: content)
    case .rejected(let topologyChanged):
      if topologyChanged {
        finishDragging()
      } else {
        logCancel(reason: "dropRejected", operationID: activeDrag.payload.operationID)
        settleDragging(receipt: nil, content: content)
      }
    }
  }

  private func settleDragging(receipt: TerminalSidebarDropReceipt?, content: Content) {
    guard activeDrag != nil, let sourceFrame = dragPresentation.sourceFrame else {
      finishDragging()
      return
    }
    autoscrollController.stop()
    layoutAnimator.finish()
    let accepted = receipt != nil
    let destination = accepted ? settlementFrame(sourceFrame: sourceFrame) : sourceFrame
    dragPresentation.settle(
      TerminalSidebarDragPresentation.Settlement(
        targetFrame: destination,
        rippleFocusFrame: collectionLayout.plan.dropPlaceholderFrame ?? destination,
        accepted: accepted,
        motionPolicy: content.motionPolicy,
        rippleCandidates: accepted ? rippleCandidates(content: content) : []
      )
    ) { [weak self] in
      self?.finishDragging(receipt: receipt)
    }
  }

  private func settlementFrame(sourceFrame: CGRect) -> CGRect {
    if let placeholder = collectionLayout.plan.dropPlaceholderFrame {
      return CGRect(
        x: placeholder.minX,
        y: placeholder.midY - sourceFrame.height / 2,
        width: sourceFrame.width,
        height: sourceFrame.height
      )
    }
    if let groupID = collectionLayout.plan.highlightedGroupID,
      let frame = collectionLayout.plan.groups.first(where: { $0.id == groupID })?.frame
    {
      return frame
    }
    return sourceFrame
  }

  private func rippleCandidates(
    content: Content
  ) -> [TerminalSidebarDragPresentation.RippleCandidate] {
    let draggedIDs = Set(activeDrag?.liftedEntryIDs ?? [])
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.plan.items.map { ($0.id, $0.frame) }
    )
    let candidates = collectionView.visibleItems().compactMap {
      item -> TerminalSidebarDragPresentation.RippleCandidate? in
      guard
        let item = item as? TerminalSidebarCollectionItem,
        let id = item.entryID,
        !draggedIDs.contains(id),
        let frame = itemFrames[id],
        frame.height > 0,
        let presentation = content.rows[id]
      else { return nil }
      switch presentation {
      case .tab, .group: break
      case .pinDivider, .newTab: return nil
      }
      item.view.wantsLayer = true
      guard let layer = item.view.layer else { return nil }
      return TerminalSidebarDragPresentation.RippleCandidate(
        layer: layer,
        frame: frame,
        center: CGPoint(x: item.view.bounds.midX, y: item.view.bounds.midY)
      )
    }
    return candidates
  }

  private func finishDragging(receipt: TerminalSidebarDropReceipt? = nil) {
    guard var activeDrag else { return }
    nativeDragSession.finish(
      operationID: activeDrag.payload.operationID,
      outcome: activeDrag.registryOutcome(receipt: receipt)
    )
    activeDrag.coordinator.finish()
    let liftedEntryIDs = activeDrag.liftedEntryIDs
    let externalSourceDisposition = activeDrag.externalCompletion.sourceDisposition
    self.activeDrag = nil
    pendingDrag = nil
    isDraggingOverPinnedControl = false
    host.content()?.swipe?.isRowDragActive = false
    guard let receipt else {
      if let sourceDisposition = externalSourceDisposition {
        host.completeDropHandoff(
          TerminalSidebarDropHandoff(
            topologyStamp: activeDrag.payload.topologyStamp,
            revisionRequirement: sourceDisposition == .retained ? .sameOrNewer : .newer
          )
        ) { [weak self] in
          guard let self else { return }
          dragPresentation.handoffAfterExternalSuccess(sourceDisposition) {
            collectionLayout.dragDropState = nil
            host.invalidateLayout()
            if sourceDisposition == .retained {
              host.rebindRows(Set(liftedEntryIDs))
            }
          }
          host.didFinish()
        }
        return
      }
      dragPresentation.handoffToSource {
        collectionLayout.dragDropState = nil
        host.invalidateLayout()
      }
      host.didFinish()
      return
    }
    collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: liftedEntryIDs,
      target: nil
    )
    host.invalidateLayout()
    host.completeDropHandoff(
      TerminalSidebarDropHandoff(
        topologyStamp: receipt.topologyStamp,
        revisionRequirement: .sameOrNewer
      )
    ) { [weak self] in
      guard let self else { return }
      dragPresentation.handoffToDestination {
        collectionLayout.dragDropState = nil
        host.invalidateLayout()
        host.rebindRows(Set(liftedEntryIDs))
      }
      host.didFinish()
    }
  }

  private func screenPoint(for event: NSEvent) -> CGPoint {
    guard let window = event.window else { return NSEvent.mouseLocation }
    return window.convertPoint(toScreen: event.locationInWindow)
  }

  private func logDrag(_ event: String, fields: [String]) {
    SupatermLog.verbose(SupatermLog.sidebarDrag, event, fields: fields)
  }

  private func logCancel(reason: String, operationID: TerminalTabMoveOperationID) {
    logDrag(
      "sidebar.drag.cancel",
      fields: TerminalSidebarDragLog.operationFields(operationID) + ["reason=\(reason)"]
    )
  }

}
