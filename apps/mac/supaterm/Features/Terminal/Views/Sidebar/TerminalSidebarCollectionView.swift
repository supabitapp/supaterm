import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class TerminalSidebarListView: NSView, NSCollectionViewDelegate {
  let scrollView = NSScrollView()
  let collectionView = TerminalSidebarCollectionView()
  let collectionLayout = TerminalSidebarCollectionLayout()

  var onDrop: ((TerminalSidebarDragValue, TerminalSidebarDropTarget.Destination) -> Void)?

  private struct ModelUpdate: Equatable {
    let model: TerminalSidebarPresentationModel
    let reduceMotion: Bool
  }

  private struct AcceptedDrop {
    let sessionID: UUID
    let drag: TerminalSidebarDragValue
    let destination: TerminalSidebarDropTarget.Destination
  }

  private struct ScrollAnchor {
    let entryID: TerminalSidebarEntryID
    let offset: CGFloat
  }

  private let dropIndicatorView = TerminalSidebarDropIndicatorView()
  private let performReorderHaptic: () -> Void
  private var dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>!
  private var itemByID: [TerminalSidebarEntryID: AnyView] = [:]
  private var measuredHeights: [TerminalSidebarEntryID: (width: CGFloat, height: CGFloat)] = [:]
  private var appliedModel = TerminalSidebarPresentationModel(entries: [], collapsedProjectIDs: [])
  private var pendingUpdate: ModelUpdate?
  private var activeCollapseUpdate: ModelUpdate?
  private var activeSnapshotUpdate: ModelUpdate?
  private var isApplyingModelUpdate = false
  private var hasAppliedSnapshot = false
  private var isLayingOutHierarchy = false
  private var activeDragValue: TerminalSidebarDragValue?
  private var activeDragSessionID: UUID?
  private var acceptedDrop: AcceptedDrop?
  private var dragSessionSource: TerminalSidebarDragSessionSource?
  private var activePreviewImage: NSImage?
  private var activePreviewRect: CGRect?
  private var activePreviewHotspot: CGPoint?
  private var dragCleanup: Task<Void, Never>?
  private var hapticTracker = TerminalSidebarHapticTargetTracker()
  private var animationsEnabled = true
  private lazy var collapseAnimator = TerminalSidebarCollapseAnimator(
    collectionView: collectionView,
    onFrame: { [weak self] visibilityByEntryID in
      guard let self else { return }
      collectionLayout.visibilityByEntryID = visibilityByEntryID
      invalidateLayout()
    },
    onCompletion: { [weak self] in
      self?.completeCollapse()
    }
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

  init(
    performReorderHaptic: @escaping () -> Void = {
      NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
    }
  ) {
    self.performReorderHaptic = performReorderHaptic
    super.init(frame: .zero)
    configureHierarchy()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override func layout() {
    super.layout()
    layoutHierarchy()
  }

  func apply(
    model: TerminalSidebarPresentationModel,
    itemByID: [TerminalSidebarEntryID: AnyView],
    reduceMotion: Bool
  ) {
    self.itemByID = itemByID
    measuredHeights.removeAll()
    refreshVisibleItems()
    let update = ModelUpdate(model: model, reduceMotion: reduceMotion)

    if let acceptedDrop,
      TerminalSidebarDropCommit.isApplied(
        drag: acceptedDrop.drag,
        destination: acceptedDrop.destination,
        entries: model.entries
      )
    {
      pendingUpdate = update
      finishDragging()
      return
    }

    if let activeCollapseUpdate {
      if activeCollapseUpdate == update {
        pendingUpdate = nil
        return
      }
      collapseAnimator.cancel()
      self.activeCollapseUpdate = nil
      isApplyingModelUpdate = false
      collectionLayout.visibilityByEntryID = [:]
    }

    if activeSnapshotUpdate == update {
      pendingUpdate = nil
      return
    }

    guard !isApplyingModelUpdate else {
      pendingUpdate = update
      return
    }

    if model == appliedModel {
      pendingUpdate = nil
      animationsEnabled = !reduceMotion
      invalidateLayout()
      return
    }

    guard activeDragValue == nil else {
      pendingUpdate = update
      return
    }
    process(update)
  }

  func setDropTarget(_ target: TerminalSidebarDropTarget?, pointerY: CGFloat?) {
    let layoutTarget = target.map(layoutDropTarget(for:))
    if collectionLayout.dropTarget != layoutTarget {
      layoutAnimator.animate(enabled: animationsEnabled) {
        self.collectionLayout.dropTarget = layoutTarget
      }
    }
    if hapticTracker.shouldPerform(for: target?.destination) {
      performReorderHaptic()
    }
    if let pointerY {
      autoscrollController.update(pointerY: pointerY)
    } else {
      autoscrollController.stop()
    }
    invalidateLayout()
  }

  func invalidateLayout() {
    collectionLayout.invalidateLayout()
    collectionView.needsLayout = true
    needsLayout = true
    guard !isLayingOutHierarchy else { return }
    layoutSubtreeIfNeeded()
  }

  private func configureHierarchy() {
    scrollView.drawsBackground = false
    scrollView.hasVerticalScroller = false
    scrollView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset
    addSubview(scrollView)

    collectionView.collectionViewLayout = collectionLayout
    collectionView.backgroundColors = [.clear]
    collectionView.isSelectable = false
    collectionView.register(
      TerminalSidebarCollectionItem.self,
      forItemWithIdentifier: TerminalSidebarCollectionItem.identifier
    )
    collectionView.registerForDraggedTypes([TerminalSidebarProjectList.dragType])
    collectionView.setDraggingSourceOperationMask(.move, forLocal: true)
    collectionView.addSubview(dropIndicatorView)
    collectionView.delegate = self
    collectionView.canBeginDrag = { [weak self] indexPath in
      guard
        let self,
        !isApplyingModelUpdate,
        activeCollapseUpdate == nil,
        let entryID = dataSource.itemIdentifier(for: indexPath),
        entryID != .newProject
      else { return nil }
      return entryID
    }
    collectionView.onDragBegan = { [weak self] entryID, mouseDownEvent, dragEvent in
      self?.beginDragging(
        entryID: entryID,
        mouseDownEvent: mouseDownEvent,
        dragEvent: dragEvent
      ) ?? false
    }
    collectionView.onDragExited = { [weak self] in
      self?.setDropTarget(nil, pointerY: nil)
    }

    dataSource = NSCollectionViewDiffableDataSource(collectionView: collectionView) {
      [weak self] collectionView, indexPath, entryID in
      guard let self else { return nil }
      let item = collectionView.makeItem(
        withIdentifier: TerminalSidebarCollectionItem.identifier,
        for: indexPath
      )
      guard let item = item as? TerminalSidebarCollectionItem else { return nil }
      item.host(itemByID[entryID] ?? AnyView(EmptyView()))
      return item
    }
    collectionLayout.preferredHeight = { [weak self] entryID, width in
      self?.preferredHeight(for: entryID, width: width) ?? TerminalSidebarLayout.tabRowMinHeight
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

  private func process(_ update: ModelUpdate) {
    animationsEnabled = !update.reduceMotion
    let targetVisibleIDs = Set(update.model.visibleEntries.map(\.id))
    let targetEntryIDs = Set(update.model.entries.map(\.id))
    let collapsingRowIDs = appliedModel.visibleEntries.compactMap { entry -> TerminalSidebarEntryID? in
      guard case .tab = entry.kind else { return nil }
      guard targetEntryIDs.contains(entry.id), !targetVisibleIDs.contains(entry.id) else { return nil }
      return entry.id
    }

    if hasAppliedSnapshot, !update.reduceMotion, !collapsingRowIDs.isEmpty {
      isApplyingModelUpdate = true
      activeCollapseUpdate = update
      collapseAnimator.start(rowIDs: collapsingRowIDs)
      return
    }
    applySnapshot(update, animated: hasAppliedSnapshot && !update.reduceMotion)
  }

  private func applySnapshot(_ update: ModelUpdate, animated: Bool) {
    isApplyingModelUpdate = true
    activeSnapshotUpdate = update
    collectionLayout.visibilityByEntryID = [:]
    collectionLayout.expansionProgress = Dictionary(
      uniqueKeysWithValues: update.model.entries.compactMap { entry in
        guard case .project(let projectID, _) = entry.kind else { return nil }
        return (projectID, 1)
      }
    )
    collectionLayout.setEntries(update.model.visibleEntries)

    var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
    snapshot.appendSections([0])
    snapshot.appendItems(update.model.visibleEntries.map(\.id), toSection: 0)
    let completion = { [weak self] in
      guard let self else { return }
      appliedModel = update.model
      activeSnapshotUpdate = nil
      collectionLayout.finishStructuralUpdate()
      hasAppliedSnapshot = true
      isApplyingModelUpdate = false
      refreshVisibleItems()
      invalidateLayout()
      consumePendingUpdate()
    }

    guard animated else {
      dataSource.apply(snapshot, animatingDifferences: false, completion: completion)
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.12
      context.timingFunction = CAMediaTimingFunction(
        controlPoints: 0.25,
        0.46,
        0.45,
        0.94
      )
      dataSource.apply(snapshot, animatingDifferences: true, completion: completion)
    }
  }

  private func completeCollapse() {
    guard let update = activeCollapseUpdate else { return }
    activeCollapseUpdate = nil
    collectionLayout.visibilityByEntryID = [:]
    applySnapshot(update, animated: false)
  }

  private func consumePendingUpdate() {
    guard activeDragValue == nil, let pendingUpdate else { return }
    self.pendingUpdate = nil
    process(pendingUpdate)
  }

  private func beginDragging(
    entryID: TerminalSidebarEntryID,
    mouseDownEvent: NSEvent,
    dragEvent: NSEvent
  ) -> Bool {
    guard
      mouseDownEvent.window === dragEvent.window,
      !isApplyingModelUpdate,
      activeCollapseUpdate == nil,
      dataSource.snapshot().itemIdentifiers.contains(entryID),
      appliedModel.visibleEntries.contains(where: { $0.id == entryID })
    else { return false }
    let value: TerminalSidebarDragValue
    switch entryID {
    case .project(let projectID):
      value = .project(projectID)
    case .tab(let tabID):
      value = .tab(tabID)
    case .newProject:
      return false
    }

    let draggedEntryIDs = draggedEntries(for: value)
    guard
      !draggedEntryIDs.isEmpty,
      let previewRect = previewRect(for: draggedEntryIDs),
      let preview = snapshot(in: previewRect)
    else { return false }

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(value.pasteboardValue, forType: TerminalSidebarProjectList.dragType)
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(previewRect, contents: preview)

    activeDragValue = value
    activePreviewImage = preview
    activePreviewRect = previewRect
    let pointer = collectionView.convert(dragEvent.locationInWindow, from: nil)
    activePreviewHotspot = CGPoint(
      x: pointer.x - previewRect.minX,
      y: pointer.y - previewRect.minY
    )
    let sessionID = UUID()
    activeDragSessionID = sessionID
    acceptedDrop = nil
    hapticTracker.reset()
    collectionLayout.draggedEntryIDs = draggedEntryIDs
    invalidateLayout()

    let source = TerminalSidebarDragSessionSource { [weak self] source, screenPoint, operation in
      guard let self, dragSessionSource === source else { return }
      dragSessionSource = nil
      collectionView.finishDragGesture()
      draggingSessionEnded(
        sessionID: sessionID,
        screenPoint: screenPoint,
        operation: operation
      )
    }
    dragSessionSource = source
    let session = collectionView.beginDraggingSession(
      with: [draggingItem],
      event: dragEvent,
      source: source
    )
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
    return true
  }

  private func draggingSessionEnded(
    sessionID: UUID,
    screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    guard activeDragSessionID == sessionID else { return }
    guard acceptedDrop?.sessionID == sessionID, operation == .move else {
      animatePreviewFromScreenPoint(screenPoint, to: activePreviewRect)
      finishDragging()
      return
    }
    dragCleanup?.cancel()
    dragCleanup = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(250))
      guard let self, !Task.isCancelled, activeDragSessionID == sessionID else { return }
      finishDragging()
    }
  }

  private func finishDragging() {
    dragCleanup?.cancel()
    dragCleanup = nil
    autoscrollController.stop()
    layoutAnimator.finish()
    collectionLayout.draggedEntryIDs = []
    collectionLayout.dropTarget = nil
    activeDragValue = nil
    activeDragSessionID = nil
    acceptedDrop = nil
    activePreviewImage = nil
    activePreviewRect = nil
    activePreviewHotspot = nil
    hapticTracker.reset()
    collectionView.finishDragGesture()
    invalidateLayout()
    guard !isApplyingModelUpdate, let pendingUpdate else { return }
    self.pendingUpdate = nil
    process(pendingUpdate)
  }

  private func draggedEntries(
    for value: TerminalSidebarDragValue
  ) -> Set<TerminalSidebarEntryID> {
    switch value {
    case .tab(let tabID):
      return [.tab(tabID)]
    case .project(let projectID):
      guard
        let headerIndex = appliedModel.visibleEntries.firstIndex(where: {
          if case .project(let id, _) = $0.kind { return id == projectID }
          return false
        })
      else { return [] }
      return Set(
        appliedModel.visibleEntries[headerIndex...].prefix { entry in
          if entry.id == .project(projectID) { return true }
          if case .tab(_, let ownerID, _) = entry.kind { return ownerID == projectID }
          return false
        }.map(\.id)
      )
    }
  }

  private func previewRect(
    for entryIDs: Set<TerminalSidebarEntryID>
  ) -> CGRect? {
    collectionLayout.plan.items.compactMap { item in
      entryIDs.contains(item.id) && item.frame.height > 0 ? item.frame : nil
    }.reduce(nil) { result, frame in
      result?.union(frame) ?? frame
    }
  }

  private func snapshot(in rect: CGRect) -> NSImage? {
    guard
      rect.width > 0,
      rect.height > 0,
      let representation = collectionView.bitmapImageRepForCachingDisplay(in: rect)
    else { return nil }
    collectionView.cacheDisplay(in: rect, to: representation)
    let image = NSImage(size: rect.size)
    image.addRepresentation(representation)
    return image
  }

  private func draggedValue(
    from draggingInfo: NSDraggingInfo
  ) -> TerminalSidebarDragValue? {
    guard
      let value = draggingInfo.draggingPasteboard.string(forType: TerminalSidebarProjectList.dragType),
      let dragged = TerminalSidebarDragValue(pasteboardValue: value),
      dragged == activeDragValue
    else { return nil }
    return dragged
  }

  private func resolvedDropTarget(
    dragged: TerminalSidebarDragValue,
    pointerY: CGFloat
  ) -> TerminalSidebarDropTarget? {
    TerminalSidebarDropTargetResolver.resolve(
      drag: dragged,
      pointerY: pointerY,
      entries: appliedModel.entries,
      frames: framesByEntryID()
    )
  }

  private func updateDropTarget(pointerY: CGFloat) {
    guard
      let dragged = activeDragValue,
      let target = resolvedDropTarget(dragged: dragged, pointerY: pointerY)
    else {
      setDropTarget(nil, pointerY: nil)
      return
    }
    setDropTarget(target, pointerY: pointerY)
  }

  private func layoutDropTarget(
    for target: TerminalSidebarDropTarget
  ) -> TerminalSidebarDropTarget {
    let precedingIDs = Set(
      appliedModel.entries.prefix(target.insertionEntryIndex).map(\.id)
    )
    let visibleIndex = appliedModel.visibleEntries.prefix { precedingIDs.contains($0.id) }.count
    return TerminalSidebarDropTarget(
      destination: target.destination,
      insertionEntryIndex: visibleIndex
    )
  }

  private func framesByEntryID() -> [TerminalSidebarEntryID: CGRect] {
    Dictionary(uniqueKeysWithValues: collectionLayout.targetPlan.items.map { ($0.id, $0.frame) })
  }

  func collectionView(
    _ collectionView: NSCollectionView,
    validateDrop draggingInfo: NSDraggingInfo,
    proposedIndexPath proposedDropIndexPath: AutoreleasingUnsafeMutablePointer<NSIndexPath>,
    dropOperation proposedDropOperation: UnsafeMutablePointer<NSCollectionView.DropOperation>
  ) -> NSDragOperation {
    guard let dragged = draggedValue(from: draggingInfo) else {
      setDropTarget(nil, pointerY: nil)
      return []
    }
    let location = collectionView.convert(draggingInfo.draggingLocation, from: nil)
    guard let target = resolvedDropTarget(dragged: dragged, pointerY: location.y) else {
      setDropTarget(nil, pointerY: nil)
      return []
    }
    let layoutTarget = layoutDropTarget(for: target)
    setDropTarget(target, pointerY: location.y)
    proposedDropIndexPath.pointee =
      IndexPath(
        item: min(layoutTarget.insertionEntryIndex, appliedModel.visibleEntries.count),
        section: 0
      ) as NSIndexPath
    proposedDropOperation.pointee = .before
    draggingInfo.animatesToDestination = false
    draggingInfo.numberOfValidItemsForDrop = 1
    return .move
  }

  func collectionView(
    _ collectionView: NSCollectionView,
    acceptDrop draggingInfo: NSDraggingInfo,
    indexPath: IndexPath,
    dropOperation: NSCollectionView.DropOperation
  ) -> Bool {
    let location = collectionView.convert(draggingInfo.draggingLocation, from: nil)
    guard
      let dragged = draggedValue(from: draggingInfo),
      let target = resolvedDropTarget(dragged: dragged, pointerY: location.y),
      let activeDragSessionID
    else {
      finishDragging()
      return false
    }
    acceptedDrop = AcceptedDrop(
      sessionID: activeDragSessionID,
      drag: dragged,
      destination: target.destination
    )
    if let indicatorFrame = collectionLayout.plan.dropIndicatorFrame,
      let previewRect = activePreviewRect,
      let hotspot = activePreviewHotspot
    {
      animatePreview(
        from: CGRect(
          x: location.x - hotspot.x,
          y: location.y - hotspot.y,
          width: previewRect.width,
          height: previewRect.height
        ),
        to: CGRect(
          x: previewRect.minX,
          y: indicatorFrame.midY - previewRect.height / 2,
          width: previewRect.width,
          height: previewRect.height
        )
      )
    }
    onDrop?(dragged, target.destination)
    return true
  }

  private func animatePreviewFromScreenPoint(
    _ screenPoint: NSPoint,
    to targetFrame: CGRect?
  ) {
    guard let window, let targetFrame, let hotspot = activePreviewHotspot else { return }
    let windowPoint = window.convertPoint(fromScreen: screenPoint)
    let collectionPoint = collectionView.convert(windowPoint, from: nil)
    animatePreview(
      from: CGRect(
        x: collectionPoint.x - hotspot.x,
        y: collectionPoint.y - hotspot.y,
        width: targetFrame.width,
        height: targetFrame.height
      ),
      to: targetFrame
    )
  }

  private func animatePreview(from startFrame: CGRect, to targetFrame: CGRect) {
    guard animationsEnabled, let activePreviewImage else { return }
    let imageView = NSImageView(frame: startFrame)
    imageView.image = activePreviewImage
    imageView.imageScaling = .scaleAxesIndependently
    imageView.alphaValue = 0.92
    collectionView.addSubview(imageView, positioned: .above, relativeTo: nil)
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.12
      context.timingFunction = CAMediaTimingFunction(
        controlPoints: 0.25,
        0.46,
        0.45,
        0.94
      )
      imageView.animator().frame = targetFrame
      imageView.animator().alphaValue = 0
    }
    Task { @MainActor [weak imageView] in
      try? await Task.sleep(for: .milliseconds(120))
      imageView?.removeFromSuperview()
    }
  }

  private func preferredHeight(
    for entryID: TerminalSidebarEntryID,
    width: CGFloat
  ) -> CGFloat {
    switch entryID {
    case .project, .newProject:
      return TerminalSidebarLayout.tabRowMinHeight
    case .tab:
      if let measurement = measuredHeights[entryID], measurement.width == width {
        return measurement.height
      }
      let controller = NSHostingController(
        rootView: itemByID[entryID] ?? AnyView(EmptyView())
      )
      let size = controller.sizeThatFits(
        in: CGSize(
          width: width,
          height: max(
            TerminalSidebarLayout.tabRowMinHeight,
            scrollView.contentView.bounds.height
          )
        )
      )
      let height = max(TerminalSidebarLayout.tabRowMinHeight, ceil(size.height))
      measuredHeights[entryID] = (width, height)
      return height
    }
  }

  private func refreshVisibleItems() {
    for item in collectionView.visibleItems() {
      guard
        let item = item as? TerminalSidebarCollectionItem,
        let indexPath = collectionView.indexPath(for: item),
        let entryID = dataSource?.itemIdentifier(for: indexPath),
        let view = itemByID[entryID]
      else { continue }
      item.host(view)
    }
  }

  private func layoutHierarchy() {
    guard !isLayingOutHierarchy else { return }
    isLayingOutHierarchy = true
    defer { isLayingOutHierarchy = false }

    let anchor = scrollAnchor()
    scrollView.frame = bounds
    scrollView.tile()
    let documentWidth = max(1, scrollView.contentView.bounds.width)
    let viewportHeight = max(1, scrollView.contentView.bounds.height)
    let startingHeight = max(viewportHeight, collectionView.frame.height)
    if collectionView.frame.size != CGSize(width: documentWidth, height: startingHeight) {
      collectionView.frame = CGRect(
        origin: .zero,
        size: CGSize(width: documentWidth, height: startingHeight)
      )
    }

    collectionLayout.invalidateLayout()
    collectionView.needsLayout = true
    collectionView.layoutSubtreeIfNeeded()
    let documentHeight = max(viewportHeight, collectionLayout.collectionViewContentSize.height)
    if collectionView.frame.size != CGSize(width: documentWidth, height: documentHeight) {
      collectionView.frame = CGRect(
        origin: .zero,
        size: CGSize(width: documentWidth, height: documentHeight)
      )
      collectionLayout.invalidateLayout()
      collectionView.needsLayout = true
      collectionView.layoutSubtreeIfNeeded()
    }
    for item in collectionView.visibleItems() {
      item.view.layoutSubtreeIfNeeded()
    }
    restore(anchor)
    updateDropIndicator()
  }

  private func scrollAnchor() -> ScrollAnchor? {
    let visibleRect = collectionView.visibleRect
    guard let item = collectionLayout.plan.items.first(where: { $0.frame.maxY >= visibleRect.minY }) else {
      return nil
    }
    return ScrollAnchor(
      entryID: item.id,
      offset: visibleRect.minY - item.frame.minY
    )
  }

  private func restore(_ anchor: ScrollAnchor?) {
    guard
      let anchor,
      let frame = collectionLayout.plan.items.first(where: { $0.id == anchor.entryID })?.frame
    else { return }
    let clipView = scrollView.contentView
    let targetY = TerminalSidebarScrollGeometry.constrainedY(
      frame.minY + anchor.offset,
      in: clipView
    )
    guard targetY != clipView.bounds.origin.y else { return }
    clipView.scroll(to: CGPoint(x: clipView.bounds.origin.x, y: targetY))
    scrollView.reflectScrolledClipView(clipView)
  }

  private func updateDropIndicator() {
    guard let frame = collectionLayout.plan.dropIndicatorFrame else {
      dropIndicatorView.isHidden = true
      return
    }
    dropIndicatorView.frame = frame
    dropIndicatorView.isHidden = false
  }

  @objc private func liveScrollDidStart() {
    autoscrollController.setLiveScrolling(true)
  }

  @objc private func liveScrollDidEnd() {
    autoscrollController.setLiveScrolling(false)
  }
}
