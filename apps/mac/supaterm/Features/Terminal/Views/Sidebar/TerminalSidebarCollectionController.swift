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

  private struct RippleCandidate {
    let layer: CALayer
    let frame: CGRect
    let center: CGPoint
  }

  private struct PendingDrag {
    let entryID: TerminalSidebarEntryID
    let eventNumber: Int
    let origin: CGPoint
    let sourceFrame: CGRect
  }

  private struct ActiveDrag {
    let payload: TerminalSidebarDragPayload
    let sourceFrame: CGRect
    let hotspot: CGPoint
    var lifecycle: TerminalSidebarDropLifecycle
    var target: TerminalSidebarDropPlan?
    var velocity = TerminalSidebarDragVelocityTracker()
    var sessionEnded = false
    var matchingSnapshotApplied = false
    var isSettling = false
  }

  private enum UpdatePhase {
    case idle
    case collapsing(Update)
    case applyingSnapshot
  }

  let renameState = TerminalSidebarRenameState()
  var performDrop: ((TerminalSidebarDropTransaction) -> TerminalSidebarDropReceipt?)?

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
  private var pendingRevealTabID: TerminalTabID?
  private var pendingDrag: PendingDrag?
  private var activeDrag: ActiveDrag?
  private var hapticTracker = TerminalSidebarHapticTargetTracker()
  private var liveDragView: TerminalSidebarLiveDragView?
  private var animationsEnabled = true
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
      animationsEnabled = !reduceMotion
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
    animationsEnabled = !update.reduceMotion
    let newlyCollapsedGroupIDs = update.outline.collapsedGroupIDs.subtracting(
      appliedOutline.collapsedGroupIDs
    )
    let collapsing = appliedOutline.visibleEntries.compactMap { entry -> TerminalSidebarEntryID? in
      guard let groupID = entry.parentGroupID, newlyCollapsedGroupIDs.contains(groupID) else {
        return nil
      }
      return entry.id
    }
    if !collapsing.isEmpty, animationsEnabled, !dataSource.snapshot().itemIdentifiers.isEmpty {
      updatePhase = .collapsing(update)
      collapseAnimator.start(rowIDs: collapsing)
      return
    }
    applySnapshot(
      update,
      animated: !dataSource.snapshot().itemIdentifiers.isEmpty && animationsEnabled
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
      pendingUpdate = update
      return
    }
    if activeDrag.matchingSnapshotApplied {
      pendingUpdate = update
      return
    }
    if case .completing = activeDrag.lifecycle.state {
      if update.outline != appliedOutline { pendingUpdate = update }
      return
    }
    guard update.outline.topologyStamp?.spaceID == activeDrag.payload.topologyStamp.spaceID else {
      applyStaleSnapshotAndCancel(update, reason: "spaceChanged")
      return
    }
    switch activeDrag.lifecycle.state {
    case .tracking:
      if update.outline.topologyRevision > activeDrag.payload.topologyRevision {
        applyStaleSnapshotAndCancel(update, reason: "sourceRevisionAdvanced")
      } else if update.outline != appliedOutline {
        pendingUpdate = update
      }
    case .completing:
      return
    case .completed:
      pendingUpdate = update
      reconcileCompletedDrop()
    }
  }

  private func reconcileCompletedDrop() {
    guard let activeDrag, !activeDrag.matchingSnapshotApplied else { return }
    switch TerminalSidebarDropReconciliation.decision(
      lifecycle: activeDrag.lifecycle,
      appliedOutline: appliedOutline,
      queuedOutline: pendingUpdate?.outline
    ) {
    case .wait:
      return
    case .acceptApplied:
      pendingUpdate = nil
      completeMatchingSnapshotSettlement(appliedOutline)
    case .applyQueued:
      guard let pendingUpdate else { return }
      applyMatchingSnapshot(pendingUpdate)
    case .cancel:
      if let pendingUpdate {
        applyStaleSnapshotAndCancel(pendingUpdate, reason: "receiptSnapshotMismatch")
      } else {
        logCancel(
          reason: "receiptSnapshotMismatch",
          operationID: activeDrag.payload.operationID
        )
        settleDragging(accepted: false)
      }
    case .rejected:
      if activeDrag.sessionEnded { settleDragging(accepted: false) }
    }
  }

  private func applyMatchingSnapshot(_ update: Update) {
    guard let operationID = activeDrag?.payload.operationID else { return }
    pendingUpdate = nil
    applySnapshot(update, animated: false) { [weak self] in
      guard let self, activeDrag?.payload.operationID == operationID else { return }
      completeMatchingSnapshotSettlement(update.outline)
    }
  }

  private func completeMatchingSnapshotSettlement(_ outline: TerminalSidebarOutline) {
    guard let operationID = activeDrag?.payload.operationID else { return }
    activeDrag?.matchingSnapshotApplied = true
    if let groupID = activeDrag?.lifecycle.receipt?.createdGroupID,
      let row = rows[.group(groupID)],
      case .group(let presentation) = row
    {
      renameState.begin(groupID: groupID, title: presentation.title)
    }
    logDrag(
      "sidebar.drag.snapshotSettlement",
      fields: operationFields(operationID) + topologyFields(outline.topologyStamp)
    )
    if activeDrag?.sessionEnded == true { settleDragging(accepted: true) }
  }

  private func applyStaleSnapshotAndCancel(_ update: Update, reason: String) {
    guard let operationID = activeDrag?.payload.operationID else { return }
    pendingUpdate = nil
    applySnapshot(update, animated: false) { [weak self] in
      guard let self, activeDrag?.payload.operationID == operationID else { return }
      logCancel(reason: reason, operationID: operationID)
      settleDragging(accepted: false)
    }
  }

  private func rowMouseDown(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    guard case .idle = updatePhase, activeDrag == nil else { return false }
    guard let payload = appliedOutline.dragPayload(for: entryID) else { return false }
    if case .group(let groupID) = payload.value, renameState.groupID == groupID { return false }
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
    let sourceIDs = Set(payload.entryIDs)
    guard
      let sourceFrame = collectionLayout.plan.items
        .filter({ sourceIDs.contains($0.id) && $0.frame.height > 0 })
        .map(\.frame)
        .reduce(Optional<CGRect>.none, { $0?.union($1) ?? $1 })
    else { return false }
    let hotspot = CGPoint(x: pointer.x - sourceFrame.minX, y: pointer.y - sourceFrame.minY)
    var active = ActiveDrag(
      payload: payload,
      sourceFrame: sourceFrame,
      hotspot: hotspot,
      lifecycle: TerminalSidebarDropLifecycle(
        operationID: payload.operationID,
        sourceTopologyStamp: payload.topologyStamp
      )
    )
    let screenPoint = screenPoint(for: event)
    active.velocity.update(point: screenPoint, timestamp: event.timestamp)
    activeDrag = active
    let liftedRows = payload.entryIDs.compactMap { entryID -> TerminalSidebarLiftedRow? in
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
    switch payload.value {
    case .group(let groupID):
      liftedGroupBackground = groupBackgroundViews[groupID].map {
        TerminalSidebarLiftedGroupBackground(id: groupID, view: $0, sourceFrame: $0.frame)
      }
    case .tab:
      liftedGroupBackground = nil
    }
    hapticTracker.reset()
    collectionLayout.dragDropState = TerminalSidebarDragDropState(
      draggingItemIDs: payload.entryIDs,
      target: nil
    )
    let liveView = TerminalSidebarLiveDragView(
      rows: liftedRows,
      groupBackground: liftedGroupBackground,
      frame: sourceFrame
    )
    collectionView.addSubview(liveView, positioned: .above, relativeTo: nil)
    liveDragView = liveView
    liveView.lift()
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
      case .tracking = activeDrag.lifecycle.state
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
    guard activeDrag?.lifecycle.state == .tracking else { return }
    setDropTarget(nil, pointerY: nil)
  }

  private func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard
      info.draggingSource as AnyObject? === collectionView,
      var activeDrag,
      let target = activeDrag.target,
      activeDrag.lifecycle.freeze(target)
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
      case .completing(let plan) = activeDrag.lifecycle.state
    else { return false }
    let transaction = TerminalSidebarDropTransaction(payload: activeDrag.payload, plan: plan)
    logDrag(
      "sidebar.drag.transactionRequest",
      fields: activeFields(activeDrag.payload) + targetFields(plan)
    )
    let receipt = performDrop?(transaction)
    guard activeDrag.lifecycle.complete(receipt) else { return false }
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
    guard var activeDrag, !activeDrag.isSettling, let liveDragView else { return }
    activeDrag.velocity.update(point: screenPoint, timestamp: CACurrentMediaTime())
    self.activeDrag = activeDrag
    guard let window = collectionView.window else { return }
    let windowPoint = window.convertPoint(fromScreen: screenPoint)
    let pointer = collectionView.convert(windowPoint, from: nil)
    let horizontalBounds = collectionView.bounds.insetBy(
      dx: TerminalSidebarLayoutPlan.horizontalInset,
      dy: 0
    )
    liveDragView.frame.origin = CGPoint(
      x: TerminalSidebarLiveDragGeometry.constrainedX(
        pointer.x - activeDrag.hotspot.x,
        frameWidth: liveDragView.frame.width,
        bounds: horizontalBounds
      ),
      y: pointer.y - activeDrag.hotspot.y
    )
  }

  private func nativeDraggingEnded(source: String) {
    pendingDrag = nil
    autoscrollController.stop()
    guard var activeDrag, !activeDrag.sessionEnded else { return }
    activeDrag.sessionEnded = true
    self.activeDrag = activeDrag
    switch activeDrag.lifecycle.state {
    case .tracking, .completing:
      logCancel(
        reason: "nativeEndedWithoutReceipt.\(source)",
        operationID: activeDrag.payload.operationID
      )
      settleDragging(accepted: false)
    case .completed(nil):
      logCancel(
        reason: "transactionRejected.\(source)",
        operationID: activeDrag.payload.operationID
      )
      settleDragging(accepted: false)
    case .completed(.some):
      if activeDrag.matchingSnapshotApplied { settleDragging(accepted: true) }
    }
  }

  private func updateDropTarget(pointerY: CGFloat) {
    guard let activeDrag, case .tracking = activeDrag.lifecycle.state else { return }
    let semanticTarget = collectionLayout.hitTestPlan.semanticTarget(at: pointerY)
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
      layoutAnimator.animate(enabled: animationsEnabled) {
        collectionLayout.dragDropState = TerminalSidebarDragDropState(
          draggingItemIDs: activeDrag.payload.entryIDs,
          target: target
        )
      }
    }
    if hapticTracker.shouldPerform(for: target?.path) {
      NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
    }
    if changed { invalidateLayout() }
  }

  private func settleDragging(accepted: Bool) {
    guard var activeDrag, !activeDrag.isSettling else { return }
    activeDrag.isSettling = true
    self.activeDrag = activeDrag
    autoscrollController.stop()
    layoutAnimator.finish()
    let destination = accepted ? settlementFrame(for: activeDrag) : activeDrag.sourceFrame
    if accepted { applyDropRipple(focusFrame: destination) }
    animateLiveDrag(
      to: destination,
      velocity: activeDrag.velocity.velocity,
      accepted: accepted
    ) { [weak self] in
      self?.finishDragging()
    }
  }

  private func settlementFrame(for activeDrag: ActiveDrag) -> CGRect {
    if let groupID = activeDrag.lifecycle.receipt?.createdGroupID,
      let frame = collectionLayout.plan.groups.first(where: { $0.id == groupID })?.frame
    {
      return frame
    }
    if let placeholder = collectionLayout.plan.dropPlaceholderFrame {
      return CGRect(
        x: placeholder.minX,
        y: placeholder.midY - activeDrag.sourceFrame.height / 2,
        width: activeDrag.sourceFrame.width,
        height: activeDrag.sourceFrame.height
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
    return activeDrag.sourceFrame
  }

  private func applyDropRipple(focusFrame: CGRect) {
    guard focusFrame.height > 0 else { return }
    let draggedIDs = Set(activeDrag?.payload.entryIDs ?? [])
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.plan.items.map { ($0.id, $0.frame) }
    )
    let candidates = collectionView.visibleItems().compactMap {
      item -> RippleCandidate? in
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
      return RippleCandidate(
        layer: layer,
        frame: frame,
        center: CGPoint(x: item.view.bounds.midX, y: item.view.bounds.midY)
      )
    }
    guard candidates.count >= 5 else { return }
    for candidate in candidates {
      let distance: CGFloat
      if candidate.frame.midY < focusFrame.minY {
        distance = focusFrame.minY - candidate.frame.midY
      } else if candidate.frame.midY > focusFrame.maxY {
        distance = candidate.frame.midY - focusFrame.maxY
      } else {
        distance = 0
      }
      guard
        let scaleDelta = TerminalSidebarDropRipple.scaleDelta(
          distance: distance,
          focusSpan: focusFrame.height
        )
      else { continue }
      candidate.layer.add(
        TerminalSidebarDropRipple.animation(
          scaleDelta: scaleDelta,
          center: candidate.center,
          distance: distance
        ),
        forKey: "dropRipple"
      )
    }
  }

  private func animateLiveDrag(
    to targetFrame: CGRect,
    velocity: CGVector,
    accepted: Bool,
    completion: @escaping @MainActor @Sendable () -> Void
  ) {
    guard let liveDragView, let layer = liveDragView.layer else {
      completion()
      return
    }
    let destination = TerminalSidebarLiveDragGeometry.settlementPosition(
      currentLayerPosition: layer.position,
      currentFrame: liveDragView.frame,
      targetFrame: targetFrame
    )
    guard animationsEnabled else {
      liveDragView.frame = targetFrame
      completion()
      return
    }
    let positionAnimation: CAAnimation
    if accepted {
      let motion = TerminalSidebarDropMotion.path(
        start: layer.position,
        destination: destination,
        velocity: velocity
      )
      let animation = CAKeyframeAnimation(keyPath: "position")
      animation.values = motion.positions.map(NSValue.init(point:))
      animation.keyTimes = motion.times.map { NSNumber(value: Double($0)) }
      animation.timingFunctions = motion.timings.map(timingFunction)
      animation.duration = motion.duration
      positionAnimation = animation
    } else {
      positionAnimation = TerminalSidebarTransformSpring.positionAnimation(
        from: layer.position,
        to: destination
      )
    }
    positionAnimation.isRemovedOnCompletion = true
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.position = destination
    let translation =
      (layer.presentation()?.value(forKeyPath: "transform.translation.y") as? NSNumber).map {
        CGFloat(truncating: $0)
      }
      ?? -2
    layer.setValue(0, forKeyPath: "transform.translation.y")
    CATransaction.setCompletionBlock {
      Task { @MainActor in completion() }
    }
    layer.add(
      TerminalSidebarTransformSpring.animation(from: translation, to: 0),
      forKey: "settleLift"
    )
    layer.add(positionAnimation, forKey: accepted ? "acceptedDrop" : "cancelledDrop")
    CATransaction.commit()
  }

  private func finishDragging() {
    liveDragView?.restore(in: collectionView)
    liveDragView?.removeFromSuperview()
    liveDragView = nil
    collectionLayout.dragDropState = nil
    activeDrag = nil
    pendingDrag = nil
    hapticTracker.reset()
    invalidateLayout()
    consumePendingUpdate()
  }

  private func timingFunction(_ timing: TerminalSidebarDropMotion.Timing) -> CAMediaTimingFunction {
    switch timing {
    case .easeOut: CAMediaTimingFunction(name: .easeOut)
    case .easeIn: CAMediaTimingFunction(name: .easeIn)
    case .easeInEaseOut: CAMediaTimingFunction(name: .easeInEaseOut)
    }
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
  }

  private func updateDecorations() {
    let groups = collectionLayout.plan.groups
    let visibleIDs = Set(groups.map(\.id))
    let liftedGroupID = liveDragView?.groupID
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
      if let context {
        background.update(
          color: group.color,
          palette: context.palette,
          highlighted: collectionLayout.plan.highlightedGroupID == group.id,
          alpha: group.alpha
        )
      }
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
    switch presentation {
    case .tab(let row):
      let tabID = row.tab.id.rawValue.uuidString.lowercased()
      guard let groupID = row.groupID else { return "sidebar.tab-row.\(tabID)" }
      return "sidebar.group.\(groupID.rawValue.uuidString.lowercased()).tab.\(tabID)"
    case .group(let row):
      return "sidebar.group-header.\(row.id.rawValue.uuidString.lowercased())"
    case .pinDivider: return "sidebar.pin-divider"
    case .newTab: return "sidebar.new-tab"
    case .newGroup: return "sidebar.new-group"
    }
  }

  private func logDrag(_ event: String, fields: [String]) {
    SupatermLog.verbose(SupatermLog.sidebarDrag, event, fields: fields)
  }

  private func activeFields(_ payload: TerminalSidebarDragPayload) -> [String] {
    operationFields(payload.operationID) + [
      "source=\(dragName(payload.value))",
      "sourceIDs=\(payload.itemIDs.map(rootID).joined(separator: ","))",
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

  private func dragName(_ value: TerminalSidebarDragValue) -> String {
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

@MainActor
private struct TerminalSidebarLiftedGroupBackground {
  let id: TerminalTabGroupID
  let view: TerminalSidebarGroupBackgroundView
  let sourceFrame: CGRect

  func install(in container: NSView, relativeTo containerFrame: CGRect) {
    view.frame = sourceFrame.offsetBy(dx: -containerFrame.minX, dy: -containerFrame.minY)
    container.addSubview(view, positioned: .below, relativeTo: nil)
  }

  func restore(in collectionView: NSCollectionView) {
    view.removeFromSuperview()
    collectionView.addSubview(view, positioned: .below, relativeTo: nil)
    view.frame = sourceFrame
  }
}

@MainActor
private final class TerminalSidebarLiveDragView: NSView {
  private let rows: [TerminalSidebarLiftedRow]
  private let groupBackground: TerminalSidebarLiftedGroupBackground?

  var groupID: TerminalTabGroupID? { groupBackground?.id }

  init(
    rows: [TerminalSidebarLiftedRow],
    groupBackground: TerminalSidebarLiftedGroupBackground?,
    frame: CGRect
  ) {
    self.rows = rows
    self.groupBackground = groupBackground
    super.init(frame: frame)
    wantsLayer = true
    layer?.zPosition = 200
    layer?.shadowColor = NSColor.black.cgColor
    layer?.shadowOpacity = 0.22
    layer?.shadowRadius = 8
    layer?.shadowOffset = CGSize(width: 0, height: -2)
    layer?.opacity = 0.96
    groupBackground?.install(in: self, relativeTo: frame)
    for row in rows {
      row.hostedView.frame = TerminalSidebarLiveDragGeometry.rowFrame(
        sourceFrame: row.sourceFrame,
        containerFrame: frame
      )
      addSubview(row.hostedView)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var isFlipped: Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func lift() {
    guard let layer else { return }
    layer.setValue(-2, forKeyPath: "transform.translation.y")
    layer.add(TerminalSidebarTransformSpring.animation(from: 0, to: -2), forKey: "lift")
  }

  func restore(in collectionView: NSCollectionView) {
    for row in rows { row.restore() }
    groupBackground?.restore(in: collectionView)
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
