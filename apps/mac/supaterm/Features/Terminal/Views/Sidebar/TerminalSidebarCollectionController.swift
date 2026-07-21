import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

final class TerminalSidebarScrollView: NSScrollView {
  override var hasVerticalScroller: Bool {
    get { false }
    set {}
  }

  override var verticalScroller: NSScroller? {
    get { nil }
    set {}
  }
}

@MainActor
final class TerminalSidebarListController: NSViewController, NSCollectionViewDelegate {
  private struct Update {
    let outline: TerminalSidebarOutline
    let reduceMotion: Bool
  }

  private struct RowMeasurement {
    let width: CGFloat
    let key: AnyHashable
    let height: CGFloat
  }

  private struct PendingDrag {
    let entryID: TerminalSidebarEntryID
    let eventNumber: Int
    let origin: CGPoint
    let sourceFrame: CGRect
  }

  private struct ActiveDrag {
    let payload: TerminalSidebarDragPayload
    let liftedEntryIDs: [TerminalSidebarEntryID]
    var coordinator: TerminalSidebarDragCoordinator
    var target: TerminalSidebarDropPlan?
  }

  private struct ReconciliationCandidate {
    let update: Update
    let isPending: Bool

    var outline: TerminalSidebarOutline { update.outline }
  }

  private enum UpdatePhase {
    case idle
    case collapsing(Update)
    case applyingSnapshot
  }

  let renameState = TerminalSidebarRenameState()
  let groupHoverState = TerminalSidebarGroupHoverState()
  var performDrop: ((TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?)?

  private let scrollView = TerminalSidebarScrollView()
  private let collectionView = TerminalSidebarCollectionView()
  private let collectionLayout = TerminalSidebarCollectionLayout()
  private let combineHighlightView = TerminalSidebarDropHighlightView()
  private var groupBackgroundViews: [TerminalTabGroupID: TerminalSidebarGroupBackgroundView] = [:]
  private var dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>!
  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
  private var context: TerminalSidebarRowContext?
  private var measuredHeights: [TerminalSidebarEntryID: RowMeasurement] = [:]
  private var appliedOutline = TerminalSidebarOutline(
    roots: [],
    collapsedGroupIDs: [],
    topologyRevision: 0
  )
  private var pendingUpdate: Update?
  private var updatePhase = UpdatePhase.idle
  private var hasAppliedSnapshot = false
  private var selectedTabID: TerminalTabID?
  private var fixedHoveredGroupID: TerminalTabGroupID?
  private var pendingRevealTabID: TerminalTabID?
  private var pendingDrag: PendingDrag?
  private var activeDrag: ActiveDrag?
  private var motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: false)
  private var isLayingOut = false

  private lazy var collapseAnimator = TerminalSidebarCollapseAnimator(
    collectionView: collectionView,
    onFrame: { [weak self] visibility in
      self?.collectionLayout.visibilityByEntryID = visibility
      self?.invalidateLayout()
    },
    onCompletion: { [weak self] in self?.completeCollapse() }
  )
  private lazy var layoutAnimator = TerminalSidebarLayoutAnimator(
    collectionView: collectionView,
    layout: collectionLayout,
    onFrame: { [weak self] in self?.invalidateLayout() }
  )
  private lazy var autoscrollController = TerminalSidebarDragAutoscrollController(
    collectionView: collectionView,
    scrollView: scrollView,
    onScroll: { [weak self] pointerY in self?.updateDropTarget(pointerY: pointerY) }
  )
  private lazy var dragPresentation = TerminalSidebarDragPresentation(
    collectionView: collectionView
  )

  override func loadView() {
    view = NSView()
    configureHierarchy()
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    layoutHierarchy()
    revealSelectedTabIfNeeded()
  }

  func apply(
    outline: TerminalSidebarOutline,
    rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation],
    context: TerminalSidebarRowContext,
    selectedTabID: TerminalTabID?,
    reduceMotion: Bool
  ) {
    self.rows = rows
    self.context = context
    fixedHoveredGroupID = context.fixedHoveredGroupID
    motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: reduceMotion)
    let groupIDs = Set(
      outline.roots.compactMap { root -> TerminalTabGroupID? in
        guard case .group(let id, _, _, _) = root.content else { return nil }
        return id
      }
    )
    groupHoverState.retain(groupIDs)
    if let fixedHoveredGroupID = context.fixedHoveredGroupID,
      groupIDs.contains(fixedHoveredGroupID)
    {
      groupHoverState.set(fixedHoveredGroupID)
    }
    measuredHeights = measuredHeights.filter { id, measurement in
      guard let row = rows[id] else { return false }
      return measurement.key == row.measurementKey
    }

    if selectedTabID != self.selectedTabID {
      let previous = self.selectedTabID
      self.selectedTabID = selectedTabID
      pendingRevealTabID = selectedTabID
      refreshVisibleRows(
        ids: Set([previous, selectedTabID].compactMap { $0 }.map(TerminalSidebarEntryID.tab))
      )
    }

    refreshVisibleRows(ids: Set(rows.keys))
    let update = Update(outline: outline, reduceMotion: reduceMotion)
    if activeDrag != nil {
      handleActiveDragUpdate(update)
      return
    }
    guard case .idle = updatePhase else {
      pendingUpdate = update
      return
    }
    if hasAppliedSnapshot, outline == appliedOutline {
      invalidateLayout()
      revealSelectedTabIfNeeded()
      return
    }
    process(update)
  }

  private func configureHierarchy() {
    scrollView.drawsBackground = false
    scrollView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset
    view.addSubview(scrollView)

    collectionView.collectionViewLayout = collectionLayout
    collectionView.backgroundColors = [.clear]
    collectionView.isSelectable = false
    collectionView.register(
      TerminalSidebarCollectionItem.self,
      forItemWithIdentifier: TerminalSidebarCollectionItem.identifier
    )
    collectionView.registerForDraggedTypes([.terminalSidebarOutlineItem])
    collectionView.setDraggingSourceOperationMask([.copy, .move], forLocal: true)
    collectionView.delegate = self
    collectionView.addSubview(combineHighlightView)
    collectionView.onRowMouseDown = { [weak self] entryID, event in
      self?.rowMouseDown(entryID: entryID, event: event) == true
    }
    collectionView.onRowMouseDragged = { [weak self] entryID, event in
      self?.rowMouseDragged(entryID: entryID, event: event) == true
    }
    collectionView.onRowMouseUp = { [weak self] entryID in
      self?.rowMouseUp(entryID: entryID) == true
    }
    collectionView.onDraggingUpdated = { [weak self] info in
      self?.draggingUpdated(info) ?? []
    }
    collectionView.onDraggingExited = { [weak self] in self?.draggingExited() }
    collectionView.onDraggingEnded = { [weak self] in
      self?.nativeDraggingEnded(source: "destination")
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
    collectionView.onDraggingSessionEnded = { [weak self] _, _ in
      self?.nativeDraggingEnded(source: "source")
    }
    collectionView.onPointerMoved = { [weak self] point in
      self?.updateGroupHover(at: point)
    }

    dataSource = NSCollectionViewDiffableDataSource(collectionView: collectionView) {
      [weak self] collectionView, indexPath, entryID in
      guard let self, let presentation = rows[entryID], let context else { return nil }
      let item = collectionView.makeItem(
        withIdentifier: TerminalSidebarCollectionItem.identifier,
        for: indexPath
      )
      guard let item = item as? TerminalSidebarCollectionItem else { return nil }
      item.host(
        TerminalSidebarHostedRow(presentation: presentation, context: context),
        entryID: entryID,
        collectionView: self.collectionView
      )
      item.view.setAccessibilityElement(true)
      item.view.setAccessibilityRole(.row)
      item.view.setAccessibilityIdentifier(accessibilityIdentifier(for: presentation))
      return item
    }
    collectionLayout.preferredHeight = { [weak self] id, width in
      self?.preferredHeight(for: id, width: width) ?? TerminalSidebarLayout.tabRowMinHeight
    }
    collectionLayout.itemIdentifiers = { [weak self] in
      self?.dataSource.snapshot().itemIdentifiers ?? []
    }
    scrollView.documentView = collectionView

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(liveScrollDidStart),
      name: NSScrollView.willStartLiveScrollNotification,
      object: scrollView
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(liveScrollDidEnd),
      name: NSScrollView.didEndLiveScrollNotification,
      object: scrollView
    )
  }

  private func process(_ update: Update) {
    motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: update.reduceMotion)
    let newlyCollapsedGroupIDs = update.outline.collapsedGroupIDs.subtracting(
      appliedOutline.collapsedGroupIDs
    )
    let collapsing = appliedOutline.visibleEntries.compactMap { entry -> TerminalSidebarEntryID? in
      guard let groupID = entry.parentGroupID, newlyCollapsedGroupIDs.contains(groupID) else {
        return nil
      }
      return entry.id
    }
    if !collapsing.isEmpty, motionPolicy.collapseStagger,
      !dataSource.snapshot().itemIdentifiers.isEmpty
    {
      updatePhase = .collapsing(update)
      collapseAnimator.start(rowIDs: collapsing)
      return
    }
    applySnapshot(
      update,
      animated: !dataSource.snapshot().itemIdentifiers.isEmpty && motionPolicy.targetInterpolation
    )
  }

  private func completeCollapse() {
    guard case .collapsing(let update) = updatePhase else { return }
    updatePhase = .idle
    collectionLayout.visibilityByEntryID = [:]
    applySnapshot(update, animated: false)
  }

  private func applySnapshot(
    _ update: Update,
    animated: Bool,
    completion additionalCompletion: (() -> Void)? = nil
  ) {
    let isInitialSnapshot = !hasAppliedSnapshot
    updatePhase = .applyingSnapshot
    collectionLayout.visibilityByEntryID = [:]
    collectionLayout.setOutline(update.outline)
    var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
    snapshot.appendSections([0])
    snapshot.appendItems(update.outline.visibleEntries.map(\.id))
    let completion = { [weak self] in
      guard let self else { return }
      appliedOutline = update.outline
      hasAppliedSnapshot = true
      updatePhase = .idle
      collectionLayout.finishStructuralUpdate()
      invalidateLayout()
      if isInitialSnapshot {
        scrollView.contentView.scroll(to: .zero)
        scrollView.reflectScrolledClipView(scrollView.contentView)
      }
      revealSelectedTabIfNeeded()
      additionalCompletion?()
      consumePendingUpdate()
    }
    guard animated else {
      dataSource.apply(snapshot, animatingDifferences: false, completion: completion)
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.12
      context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
      dataSource.apply(snapshot, animatingDifferences: true, completion: completion)
    }
  }

  private func consumePendingUpdate() {
    guard case .idle = updatePhase, activeDrag == nil, let pendingUpdate else { return }
    self.pendingUpdate = nil
    process(pendingUpdate)
  }

  private func handleActiveDragUpdate(_ update: Update) {
    guard let activeDrag else { return }
    guard case .idle = updatePhase else {
      queue(update)
      return
    }
    switch activeDrag.coordinator.phase {
    case .tracking:
      guard update.outline.topologyStamp == activeDrag.payload.topologyStamp else {
        applyIncompatibleSnapshotAndCancel(update, reason: "sourceTopologyChanged")
        return
      }
      if update.outline != appliedOutline {
        applyIncompatibleSnapshotAndCancel(update, reason: "sourceSnapshotMismatch")
      }
    case .frozen, .awaitingNativeEnd, .awaitingSnapshot:
      queue(update)
      reconcileCompletedDrop()
    case .settling, .finished:
      queue(update)
    }
  }

  private func reconcileCompletedDrop() {
    guard var activeDrag else { return }
    let candidate = reconciliationCandidate()
    switch activeDrag.coordinator.snapshotDisposition(for: candidate.outline) {
    case .waiting, .rejected:
      return
    case .exact:
      if candidate.isPending {
        pendingUpdate = nil
        applySnapshot(candidate.update, animated: false) { [weak self] in
          self?.recordSnapshot(.exact, outline: candidate.outline)
        }
      } else {
        recordSnapshot(.exact, outline: candidate.outline)
      }
    case .superseding:
      stopDropTargetPresentation()
      if candidate.isPending {
        pendingUpdate = nil
        applySnapshot(candidate.update, animated: false) { [weak self] in
          self?.recordSnapshot(.superseding, outline: candidate.outline)
        }
      } else {
        recordSnapshot(.superseding, outline: candidate.outline)
      }
    case .incompatible:
      if candidate.isPending {
        applyIncompatibleSnapshotAndCancel(candidate.update, reason: "receiptSnapshotMismatch")
      } else if let settlement = activeDrag.coordinator.cancel(topologyChanged: true) {
        self.activeDrag = activeDrag
        logCancel(reason: "receiptSnapshotMismatch", operationID: activeDrag.payload.operationID)
        beginSettlement(settlement)
      }
    }
  }

  private func queue(_ update: Update) {
    guard let current = pendingUpdate else {
      pendingUpdate = update
      return
    }
    guard
      let currentStamp = current.outline.topologyStamp,
      let nextStamp = update.outline.topologyStamp,
      currentStamp.spaceID == nextStamp.spaceID
    else {
      pendingUpdate = update
      return
    }
    if nextStamp.revision >= currentStamp.revision { pendingUpdate = update }
  }

  private func reconciliationCandidate() -> ReconciliationCandidate {
    if let pendingUpdate {
      guard
        let pendingStamp = pendingUpdate.outline.topologyStamp,
        let appliedStamp = appliedOutline.topologyStamp,
        pendingStamp.spaceID == appliedStamp.spaceID
      else { return ReconciliationCandidate(update: pendingUpdate, isPending: true) }
      if pendingStamp.revision >= appliedStamp.revision {
        return ReconciliationCandidate(update: pendingUpdate, isPending: true)
      }
      self.pendingUpdate = nil
    }
    return ReconciliationCandidate(
      update: Update(outline: appliedOutline, reduceMotion: motionPolicy.reduceMotion),
      isPending: false
    )
  }

  private func recordSnapshot(
    _ acceptance: TerminalSidebarDragCoordinator.SnapshotAcceptance,
    outline: TerminalSidebarOutline
  ) {
    guard var activeDrag else { return }
    let settlement = activeDrag.coordinator.recordSnapshot(acceptance)
    self.activeDrag = activeDrag
    logDrag(
      "sidebar.drag.snapshotSettlement",
      fields: operationFields(activeDrag.payload.operationID)
        + topologyFields(outline.topologyStamp)
        + ["outcome=\(acceptance)"]
    )
    if let settlement {
      beginSettlement(settlement)
    } else if pendingUpdate != nil {
      reconcileCompletedDrop()
    }
  }

  private func applyIncompatibleSnapshotAndCancel(_ update: Update, reason: String) {
    guard let operationID = activeDrag?.payload.operationID else { return }
    pendingUpdate = nil
    applySnapshot(update, animated: false) { [weak self] in
      guard let self, var activeDrag, activeDrag.payload.operationID == operationID else { return }
      let settlement = activeDrag.coordinator.cancel(topologyChanged: true)
      self.activeDrag = activeDrag
      logCancel(reason: reason, operationID: operationID)
      if let settlement { beginSettlement(settlement) }
    }
  }

  private func rowMouseDown(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    guard case .idle = updatePhase, activeDrag == nil else { return false }
    guard let payload = appliedOutline.dragPayload(for: entryID) else { return false }
    if case .group(let groupID) = payload.source, renameState.groupID == groupID { return false }
    guard
      let indexPath = dataSource.indexPath(for: entryID),
      let attributes = collectionLayout.layoutAttributesForItem(at: indexPath)
    else { return false }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    guard attributes.frame.contains(location) else { return false }
    pendingDrag = PendingDrag(
      entryID: entryID,
      eventNumber: event.eventNumber,
      origin: location,
      sourceFrame: attributes.frame
    )
    return false
  }

  private func rowMouseDragged(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    guard let pendingDrag, pendingDrag.entryID == entryID else { return false }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    switch TerminalSidebarDragActivation.decision(
      mouseDownEventNumber: pendingDrag.eventNumber,
      currentEventNumber: event.eventNumber,
      origin: pendingDrag.origin,
      location: location,
      sourceFrame: pendingDrag.sourceFrame
    ) {
    case .pending:
      return false
    case .rejected:
      self.pendingDrag = nil
      return false
    case .begin:
      self.pendingDrag = nil
      return beginDragging(entryID: entryID, event: event, pointer: location)
    }
  }

  private func rowMouseUp(entryID: TerminalSidebarEntryID) -> Bool {
    let consumes = activeDrag != nil && pendingDrag?.entryID == nil
    if pendingDrag?.entryID == entryID { pendingDrag = nil }
    return consumes
  }

  private func beginDragging(
    entryID: TerminalSidebarEntryID,
    event: NSEvent,
    pointer: CGPoint
  ) -> Bool {
    guard
      case .idle = updatePhase,
      let payload = appliedOutline.dragPayload(for: entryID)
    else { return false }
    let liftedEntryIDs = appliedOutline.liftedEntryIDs(for: payload.source)
    setHoveredGroupID(nil)
    let sourceIDs = Set(liftedEntryIDs)
    guard
      let sourceFrame = collectionLayout.plan.items
        .filter({ sourceIDs.contains($0.id) && $0.frame.height > 0 })
        .map(\.frame)
        .reduce(Optional<CGRect>.none, { $0?.union($1) ?? $1 })
    else { return false }
    let hotspot = CGPoint(x: pointer.x - sourceFrame.minX, y: pointer.y - sourceFrame.minY)
    let active = ActiveDrag(
      payload: payload,
      liftedEntryIDs: liftedEntryIDs,
      coordinator: TerminalSidebarDragCoordinator(payload: payload),
      target: nil
    )
    let screenPoint = screenPoint(for: event)
    activeDrag = active
    let liftedRows = liftedEntryIDs.compactMap { entryID -> TerminalSidebarLiftedRow? in
      guard
        let indexPath = dataSource.indexPath(for: entryID),
        let item = collectionView.item(at: indexPath) as? TerminalSidebarCollectionItem,
        let sourceItem = collectionLayout.plan.items.first(where: { $0.id == entryID })
      else { return nil }
      return item.liftHostedView(sourceFrame: sourceItem.frame)
    }
    guard !liftedRows.isEmpty else {
      activeDrag = nil
      return false
    }
    let liftedGroupBackground: TerminalSidebarLiftedGroupBackground?
    switch payload.source {
    case .group(let groupID):
      liftedGroupBackground = groupBackgroundViews[groupID].map {
        TerminalSidebarLiftedGroupBackground(id: groupID, view: $0, sourceFrame: $0.frame)
      }
    case .tab:
      liftedGroupBackground = nil
    }
    collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: liftedEntryIDs,
      target: nil
    )
    dragPresentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: liftedRows,
        groupBackground: liftedGroupBackground,
        sourceFrame: sourceFrame,
        hotspot: hotspot,
        screenPoint: screenPoint,
        timestamp: event.timestamp
      ),
      motionPolicy: motionPolicy
    )
    invalidateLayout()
    logDrag(
      "sidebar.drag.activation",
      fields: activeFields(payload) + [
        "sourceMinY=\(coordinate(sourceFrame.minY))",
        "sourceMaxY=\(coordinate(sourceFrame.maxY))",
      ]
    )

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(
      payload.operationID.rawValue.uuidString,
      forType: .terminalSidebarOutlineItem
    )
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      sourceFrame,
      contents: nil
    )
    let session = collectionView.beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: collectionView
    )
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
    return true
  }

  private func draggingUpdated(_ info: any NSDraggingInfo) -> NSDragOperation {
    guard
      info.draggingSource as AnyObject? === collectionView,
      let activeDrag,
      case .tracking = activeDrag.coordinator.phase
    else { return [] }
    let location = collectionView.convert(info.draggingLocation, from: nil)
    autoscrollController.update(pointerY: location.y)
    updateDropTarget(pointerY: location.y)
    guard self.activeDrag?.target != nil else { return [] }
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  private func draggingExited() {
    autoscrollController.stop()
    guard let activeDrag, case .tracking = activeDrag.coordinator.phase else { return }
    setDropTarget(nil, pointerY: nil)
  }

  private func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard
      info.draggingSource as AnyObject? === collectionView,
      var activeDrag,
      let target = activeDrag.target,
      activeDrag.coordinator.freeze(target) != nil
    else { return false }
    self.activeDrag = activeDrag
    autoscrollController.stop()
    logDrag(
      "sidebar.drag.freeze",
      fields: activeFields(activeDrag.payload) + targetFields(target)
    )
    return true
  }

  private func performDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard
      info.draggingSource as AnyObject? === collectionView,
      var activeDrag,
      let command = activeDrag.coordinator.command,
      let plan = activeDrag.coordinator.frozenPlan
    else { return false }
    logDrag(
      "sidebar.drag.transactionRequest",
      fields: activeFields(activeDrag.payload) + targetFields(plan)
    )
    let receipt = performDrop?(command)
    guard activeDrag.coordinator.complete(receipt) else { return false }
    self.activeDrag = activeDrag
    if let receipt {
      logDrag(
        "sidebar.drag.receiptSuccess",
        fields: activeFields(activeDrag.payload) + [
          "receiptRevision=\(receipt.topologyRevision)",
          "deletedGroupCount=\(receipt.deletedEmptyGroupIDs.count)",
        ]
      )
    } else {
      logDrag(
        "sidebar.drag.receiptRejection",
        fields: activeFields(activeDrag.payload) + ["reason=transactionRejected"]
      )
    }
    reconcileCompletedDrop()
    return receipt != nil
  }

  private func draggingSessionMoved(to screenPoint: NSPoint) {
    guard let activeDrag else { return }
    switch activeDrag.coordinator.phase {
    case .settling, .finished: return
    case .tracking, .frozen, .awaitingNativeEnd, .awaitingSnapshot: break
    }
    dragPresentation.move(to: screenPoint)
  }

  private func nativeDraggingEnded(source: String) {
    pendingDrag = nil
    autoscrollController.stop()
    guard var activeDrag else { return }
    let previousPhase = activeDrag.coordinator.phase
    let settlement = activeDrag.coordinator.nativeEnded()
    self.activeDrag = activeDrag
    switch previousPhase {
    case .tracking, .frozen:
      logCancel(
        reason: "nativeEndedWithoutReceipt.\(source)",
        operationID: activeDrag.payload.operationID
      )
    case .awaitingNativeEnd(_, nil, _):
      logCancel(
        reason: "transactionRejected.\(source)",
        operationID: activeDrag.payload.operationID
      )
    case .awaitingNativeEnd, .awaitingSnapshot, .settling, .finished:
      break
    }
    if let settlement { beginSettlement(settlement) }
  }

  private func updateDropTarget(pointerY: CGFloat) {
    guard let activeDrag, case .tracking = activeDrag.coordinator.phase else { return }
    let semanticTarget = collectionLayout.dropTargetMap.semanticTarget(at: pointerY)
    let target = semanticTarget.flatMap {
      TerminalSidebarDropPlanner.plan(
        payload: activeDrag.payload,
        path: $0.path,
        outline: appliedOutline
      )
    }
    setDropTarget(target, pointerY: pointerY)
  }

  private func setDropTarget(_ target: TerminalSidebarDropPlan?, pointerY: CGFloat?) {
    guard var activeDrag else { return }
    let changed = activeDrag.target != target
    if changed {
      activeDrag.target = target
      self.activeDrag = activeDrag
      logDrag(
        "sidebar.drag.targetTransition",
        fields: activeFields(activeDrag.payload)
          + ["pointerY=\(pointerY.map(coordinate) ?? "nil")"]
          + (target.map(targetFields) ?? ["semanticTarget=none"])
      )
      layoutAnimator.animate(enabled: motionPolicy.targetInterpolation) {
        collectionLayout.dragDropState = TerminalSidebarDragDropState(
          draggingItemIDs: activeDrag.liftedEntryIDs,
          target: target
        )
      }
    }
    dragPresentation.updateHapticTarget(target?.path)
    if changed { invalidateLayout() }
  }

  private func beginSettlement(_ settlement: TerminalSidebarDragCoordinator.Settlement) {
    guard let activeDrag else { return }
    switch settlement {
    case .accepted(let receipt):
      if let groupID = receipt.createdGroupID,
        let row = rows[.group(groupID)],
        case .group(let presentation) = row
      {
        renameState.begin(groupID: groupID, title: presentation.title)
      }
      settleDragging(accepted: true)
    case .superseded:
      finishDragging()
    case .rejected(let topologyChanged):
      if topologyChanged {
        finishDragging()
      } else {
        logCancel(reason: "dropRejected", operationID: activeDrag.payload.operationID)
        settleDragging(accepted: false)
      }
    }
  }

  private func settleDragging(accepted: Bool) {
    guard let activeDrag, let sourceFrame = dragPresentation.sourceFrame else {
      finishDragging()
      return
    }
    autoscrollController.stop()
    layoutAnimator.finish()
    let destination = accepted ? settlementFrame(for: activeDrag, sourceFrame: sourceFrame) : sourceFrame
    dragPresentation.settle(
      to: destination,
      accepted: accepted,
      motionPolicy: motionPolicy,
      rippleCandidates: accepted ? rippleCandidates() : []
    ) { [weak self] in
      self?.finishDragging()
    }
  }

  private func settlementFrame(for activeDrag: ActiveDrag, sourceFrame: CGRect) -> CGRect {
    if let groupID = activeDrag.coordinator.receipt?.createdGroupID,
      let frame = collectionLayout.plan.groups.first(where: { $0.id == groupID })?.frame
    {
      return frame
    }
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
    if let tabID = collectionLayout.plan.highlightedTabID,
      let frame = collectionLayout.plan.items.first(where: { $0.id == .tab(tabID) })?.frame
    {
      return frame
    }
    return sourceFrame
  }

  private func rippleCandidates() -> [TerminalSidebarDragPresentation.RippleCandidate] {
    let draggedIDs = Set(activeDrag?.liftedEntryIDs ?? [])
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.plan.items.map { ($0.id, $0.frame) }
    )
    let candidates = collectionView.visibleItems().compactMap {
      item -> TerminalSidebarDragPresentation.RippleCandidate? in
      guard
        let item = item as? TerminalSidebarCollectionItem,
        let indexPath = collectionView.indexPath(for: item),
        let id = dataSource.itemIdentifier(for: indexPath),
        !draggedIDs.contains(id),
        let frame = itemFrames[id],
        frame.height > 0,
        let presentation = rows[id]
      else { return nil }
      switch presentation {
      case .tab, .group: break
      case .pinDivider, .newTab, .newGroup: return nil
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

  private func finishDragging() {
    dragPresentation.finish()
    collectionLayout.dragDropState = nil
    activeDrag?.coordinator.finish()
    activeDrag = nil
    pendingDrag = nil
    invalidateLayout()
    consumePendingUpdate()
  }

  private func stopDropTargetPresentation() {
    autoscrollController.stop()
    layoutAnimator.finish()
    collectionLayout.dragDropState = nil
    activeDrag?.target = nil
    dragPresentation.resetHapticTarget()
    invalidateLayout()
  }

  private func preferredHeight(for id: TerminalSidebarEntryID, width: CGFloat) -> CGFloat {
    if case .pinDivider = id { return TerminalSidebarLayoutPlan.dividerHeight }
    guard let presentation = rows[id], let context else {
      return TerminalSidebarLayout.tabRowMinHeight
    }
    if case .group = presentation { return TerminalSidebarLayoutPlan.targetRowHeight }
    if let measurement = measuredHeights[id], measurement.width == width,
      measurement.key == presentation.measurementKey
    {
      return measurement.height
    }
    let controller = NSHostingController(
      rootView: TerminalSidebarHostedRow(presentation: presentation, context: context)
    )
    let height = max(
      TerminalSidebarLayout.tabRowMinHeight,
      ceil(controller.sizeThatFits(in: CGSize(width: width, height: 2_000)).height)
    )
    measuredHeights[id] = RowMeasurement(
      width: width,
      key: presentation.measurementKey,
      height: height
    )
    return height
  }

  private func refreshVisibleRows(ids: Set<TerminalSidebarEntryID>) {
    guard let context else { return }
    for item in collectionView.visibleItems() {
      guard
        let item = item as? TerminalSidebarCollectionItem,
        let indexPath = collectionView.indexPath(for: item),
        let id = dataSource?.itemIdentifier(for: indexPath),
        ids.contains(id),
        let presentation = rows[id]
      else { continue }
      item.host(
        TerminalSidebarHostedRow(presentation: presentation, context: context),
        entryID: id,
        collectionView: collectionView
      )
      item.view.setAccessibilityIdentifier(accessibilityIdentifier(for: presentation))
    }
  }

  private func invalidateLayout() {
    collectionLayout.invalidateLayout()
    collectionView.needsLayout = true
    view.needsLayout = true
    guard !isLayingOut else { return }
    view.layoutSubtreeIfNeeded()
  }

  private func layoutHierarchy() {
    guard !isLayingOut else { return }
    isLayingOut = true
    defer { isLayingOut = false }
    scrollView.frame = view.bounds
    scrollView.tile()
    let documentWidth = max(1, scrollView.contentView.bounds.width)
    let viewportHeight = max(1, scrollView.contentView.bounds.height)
    collectionView.frame.size = CGSize(
      width: documentWidth,
      height: max(viewportHeight, collectionView.frame.height)
    )
    collectionLayout.invalidateLayout()
    collectionView.layoutSubtreeIfNeeded()
    collectionView.frame.size = CGSize(
      width: documentWidth,
      height: max(viewportHeight, collectionLayout.collectionViewContentSize.height)
    )
    collectionLayout.invalidateLayout()
    collectionView.layoutSubtreeIfNeeded()
    updateDecorations()
    updateGroupHover(at: collectionView.pointerLocation)
  }

  private func updateDecorations() {
    let groups = collectionLayout.plan.groups
    let visibleIDs = Set(groups.map(\.id))
    let liftedGroupID = dragPresentation.groupID
    for (id, view) in groupBackgroundViews
    where !visibleIDs.contains(id) && id != liftedGroupID {
      view.removeFromSuperview()
      groupBackgroundViews[id] = nil
    }
    for group in groups {
      let background =
        groupBackgroundViews[group.id]
        ?? {
          let background = TerminalSidebarGroupBackgroundView(frame: .zero)
          collectionView.addSubview(background, positioned: .below, relativeTo: nil)
          groupBackgroundViews[group.id] = background
          return background
        }()
      background.frame = group.frame
      updateGroupSurface(group: group, background: background)
      background.needsLayout = true
    }
    if let tabID = collectionLayout.plan.highlightedTabID,
      let frame = collectionLayout.plan.items.first(where: { $0.id == .tab(tabID) })?.frame
    {
      combineHighlightView.frame = frame
      combineHighlightView.isHidden = false
    } else {
      combineHighlightView.isHidden = true
    }
  }

  private func refreshGroupSurfaces(ids: Set<TerminalTabGroupID>) {
    for id in ids {
      guard
        let group = collectionLayout.plan.groups.first(where: { $0.id == id }),
        let background = groupBackgroundViews[id]
      else { continue }
      updateGroupSurface(group: group, background: background)
    }
  }

  private func updateGroupHover(at point: CGPoint?) {
    let groupID =
      fixedHoveredGroupID
      ?? (activeDrag == nil ? point.flatMap(collectionLayout.plan.groupID(at:)) : nil)
    setHoveredGroupID(groupID)
  }

  private func setHoveredGroupID(_ groupID: TerminalTabGroupID?) {
    guard groupHoverState.groupID != groupID else { return }
    let previous = groupHoverState.groupID
    groupHoverState.set(groupID)
    refreshGroupSurfaces(ids: Set([previous, groupID].compactMap { $0 }))
  }

  private func updateGroupSurface(
    group: TerminalSidebarLayoutPlan.Group,
    background: TerminalSidebarGroupBackgroundView
  ) {
    guard let context else { return }
    background.update(
      color: group.color,
      palette: context.palette,
      surfaceState: TerminalSidebarGroupSurfaceState.resolve(
        isHovered: groupHoverState.groupID == group.id,
        isDropTarget: collectionLayout.plan.highlightedGroupID == group.id
      ),
      alpha: group.alpha,
      reduceMotion: !motionPolicy.hoverFade
    )
  }

  private func revealSelectedTabIfNeeded() {
    guard let id = pendingRevealTabID else { return }
    let entryID = TerminalSidebarEntryID.tab(id)
    guard dataSource.snapshot().itemIdentifiers.contains(entryID),
      let frame = collectionLayout.targetPlan.items.first(where: { $0.id == entryID })?.frame
    else { return }
    let visibleRect = collectionView.visibleRect
    guard visibleRect.height >= TerminalSidebarLayout.tabRowMinHeight else { return }
    if visibleRect.contains(frame) {
      pendingRevealTabID = nil
      return
    }
    collectionView.scrollToVisible(frame)
    pendingRevealTabID = nil
  }

  func collectionView(
    _ collectionView: NSCollectionView,
    willDisplay item: NSCollectionViewItem,
    forRepresentedObjectAt indexPath: IndexPath
  ) {
    guard let id = dataSource.itemIdentifier(for: indexPath) else { return }
    measuredHeights[id] = nil
    invalidateLayout()
  }

  private func screenPoint(for event: NSEvent) -> CGPoint {
    guard let window = event.window else { return NSEvent.mouseLocation }
    return window.convertPoint(toScreen: event.locationInWindow)
  }

  private func accessibilityIdentifier(for presentation: TerminalSidebarRowPresentation) -> String {
    TerminalSidebarAccessibilityIdentifier.row(presentation)
  }

  private func logDrag(_ event: String, fields: [String]) {
    SupatermLog.verbose(SupatermLog.sidebarDrag, event, fields: fields)
  }

  private func activeFields(_ payload: TerminalSidebarDragPayload) -> [String] {
    operationFields(payload.operationID) + [
      "source=\(dragName(payload.source))",
      "sourceID=\(rootID(payload.source.itemID))",
      "sourceSpace=\(SupatermLog.uuid(payload.topologyStamp.spaceID.rawValue))",
      "sourceRevision=\(payload.topologyStamp.revision)",
    ]
  }

  private func topologyFields(_ stamp: TerminalSidebarTopologyStamp?) -> [String] {
    guard let stamp else { return ["space=nil", "revision=0"] }
    return [
      "space=\(SupatermLog.uuid(stamp.spaceID.rawValue))",
      "revision=\(stamp.revision)",
    ]
  }

  private func operationFields(_ operationID: TerminalTabMoveOperationID) -> [String] {
    ["operationID=\(SupatermLog.uuid(operationID.rawValue))"]
  }

  private func targetFields(_ plan: TerminalSidebarDropPlan) -> [String] {
    ["semanticTarget=\(semanticPath(plan.path))", "destination=\(destination(plan.destination))"]
  }

  private func logCancel(reason: String, operationID: TerminalTabMoveOperationID) {
    logDrag(
      "sidebar.drag.cancel",
      fields: operationFields(operationID) + ["reason=\(reason)"]
    )
  }

  private func dragName(_ value: TerminalSidebarDragSource) -> String {
    switch value {
    case .tab: "tab"
    case .group: "group"
    }
  }

  private func rootID(_ id: TerminalTabRootItemID) -> String {
    switch id {
    case .tab(let id): "tab:\(SupatermLog.uuid(id.rawValue))"
    case .group(let id): "group:\(SupatermLog.uuid(id.rawValue))"
    }
  }

  private func semanticPath(_ path: TerminalSidebarSemanticPath) -> String {
    switch path {
    case .rootItem(let index): "rootItem:\(index)"
    case .rootBoundary(let index, let affinity): "rootBoundary:\(index):\(affinity)"
    case .group(let id, let index): "group:\(SupatermLog.uuid(id.rawValue)):\(index)"
    case .pinnedEnd: "pinnedEnd"
    case .trailingRoot: "trailingRoot"
    }
  }

  private func destination(_ destination: TerminalSidebarDropDestination) -> String {
    switch destination {
    case .root(let isPinned, let index): "root:\(isPinned):\(index)"
    case .group(let id, let index): "group:\(SupatermLog.uuid(id.rawValue)):\(index)"
    case .createGroup(let id): "createGroup:\(SupatermLog.uuid(id.rawValue))"
    }
  }

  private func coordinate(_ value: CGFloat) -> String {
    String(format: "%.1f", Double(value))
  }

  @objc private func liveScrollDidStart() {
    autoscrollController.setLiveScrolling(true)
  }

  @objc private func liveScrollDidEnd() {
    autoscrollController.setLiveScrolling(false)
  }
}

private final class TerminalSidebarDropHighlightView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.borderWidth = 1.5
    layer?.borderColor = NSColor.controlAccentColor.cgColor
    layer?.cornerRadius = TerminalSidebarLayout.tabRowCornerRadius
    layer?.zPosition = 100
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
