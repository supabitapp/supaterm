import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

@MainActor
final class TerminalSidebarControllerCache {
  private var controllersBySpaceID: [TerminalSpaceID: TerminalSidebarListController] = [:]
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID

  init(
    windowControllerID: UUID = UUID(),
    tabDragRegistry: TerminalTabDragRegistry = TerminalTabDragRegistry()
  ) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
  }

  var count: Int {
    controllersBySpaceID.count
  }

  func controller(for spaceID: TerminalSpaceID) -> TerminalSidebarListController {
    if let controller = controllersBySpaceID[spaceID] {
      return controller
    }
    let controller = TerminalSidebarListController(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry
    )
    controllersBySpaceID[spaceID] = controller
    return controller
  }

  func retain(_ spaceIDs: [TerminalSpaceID]) {
    let retained = Set(spaceIDs)
    controllersBySpaceID = controllersBySpaceID.filter { retained.contains($0.key) }
  }
}

final class TerminalSidebarScrollView: NSScrollView {
  nonisolated override var hasVerticalScroller: Bool {
    get { false }
    set {}
  }

  nonisolated override var verticalScroller: NSScroller? {
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
  let groupHeaderHoverState = TerminalSidebarGroupHoverState()
  let tabSelectionState = TerminalSidebarTabSelectionState()
  var performDrop: ((TerminalSidebarDropCommand) -> TerminalSidebarDropReceipt?)? {
    get { dragController.performDrop }
    set { dragController.performDrop = newValue }
  }
  var swipe: SpaceSwipeController?

  private let scrollView = TerminalSidebarScrollView()
  private let collectionView = TerminalSidebarCollectionView()
  private let collectionLayout = TerminalSidebarCollectionLayout()
  private let selectionGlowView = TerminalSidebarSelectionGlowView()
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
  private var motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: false)
  private var isLayingOut = false
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID

  private lazy var collapseAnimator = TerminalSidebarCollapseAnimator(
    collectionView: collectionView,
    onFrame: { [weak self] visibility in
      self?.collectionLayout.visibilityByEntryID = visibility
      self?.invalidateLayout()
    },
    onCompletion: { [weak self] in self?.completeCollapse() }
  )
  private lazy var dragController = TerminalSidebarDragController(
    collectionView: collectionView,
    collectionLayout: collectionLayout,
    scrollView: scrollView,
    sourceWindowID: windowControllerID,
    tabDragRegistry: tabDragRegistry,
    host: TerminalSidebarDragController.Host(
      content: { [weak self] in
        guard let self, let context else { return nil }
        let canBeginDrag = if case .idle = updatePhase { true } else { false }
        return TerminalSidebarDragController.Content(
          outline: appliedOutline,
          selectedTabID: selectedTabID,
          rows: rows,
          context: context,
          motionPolicy: motionPolicy,
          canBeginDrag: canBeginDrag,
          swipe: swipe,
          groupBackgroundViews: groupBackgroundViews
        )
      },
      indexPath: { [weak self] in self?.dataSource?.indexPath(for: $0) },
      entryID: { [weak self] in self?.dataSource?.itemIdentifier(for: $0) },
      invalidateLayout: { [weak self] in self?.invalidateLayout() },
      reconcileCompletedDrop: { [weak self] in self?.reconcileCompletedDrop() },
      hasPendingUpdate: { [weak self] in self?.pendingUpdate != nil },
      didFinish: { [weak self] in self?.consumePendingUpdate() },
      setHoveredGroupID: { [weak self] in self?.setHoveredGroupID($0) }
    )
  )

  init(windowControllerID: UUID, tabDragRegistry: TerminalTabDragRegistry) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

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
    dragController.pinnedControl.update(context: context)
    fixedHoveredGroupID = context.fixedHoveredGroupID
    motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: reduceMotion)
    let groupIDs = Set(
      outline.roots.compactMap { root -> TerminalTabGroupID? in
        guard case .group(let id, _, _, _) = root.content else { return nil }
        return id
      }
    )
    groupHoverState.retain(groupIDs)
    groupHeaderHoverState.retain(groupIDs)
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
      tabSelectionState.clear()
      self.selectedTabID = selectedTabID
      pendingRevealTabID = selectedTabID
      refreshVisibleRows(
        ids: Set([previous, selectedTabID].compactMap { $0 }.map(TerminalSidebarEntryID.tab))
      )
    }
    tabSelectionState.retainVisible(in: outline, primaryTabID: selectedTabID)

    refreshVisibleRows(ids: Set(rows.keys))
    let update = Update(outline: outline, reduceMotion: reduceMotion)
    if dragController.isActive {
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
    scrollView.automaticallyAdjustsContentInsets = false
    scrollView.setAccessibilityElement(true)
    scrollView.setAccessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.tabOutline)
    scrollView.setAccessibilityRole(.scrollArea)
    scrollView.setAccessibilityLabel("Tabs")
    view.addSubview(scrollView)
    view.addSubview(dragController.pinnedControl.view)

    collectionView.collectionViewLayout = collectionLayout
    collectionView.backgroundColors = [.clear]
    collectionView.isSelectable = false
    collectionView.register(
      TerminalSidebarCollectionItem.self,
      forItemWithIdentifier: TerminalSidebarCollectionItem.identifier
    )
    collectionView.registerForDraggedTypes([.terminalTabDrag])
    collectionView.setDraggingSourceOperationMask(.move, forLocal: true)
    collectionView.delegate = self
    collectionView.addSubview(selectionGlowView, positioned: .below, relativeTo: nil)
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
      item.host(TerminalSidebarHostedRow(presentation: presentation, context: context))
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
    scrollView.contentView.postsBoundsChangedNotifications = true

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(liveScrollDidStart),
      name: NSScrollView.willStartLiveScrollNotification,
      object: scrollView
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(scrollViewDidScroll),
      name: NSView.boundsDidChangeNotification,
      object: scrollView.contentView
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
        let contentView = scrollView.contentView
        contentView.scroll(to: contentView.documentRect.origin)
        scrollView.reflectScrolledClipView(contentView)
      }
      revealSelectedTabIfNeeded()
      additionalCompletion?()
      consumePendingUpdate()
    }
    if isInitialSnapshot {
      dataSource.apply(snapshot, animatingDifferences: false)
      completion()
      return
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
    Task { @MainActor [weak self] in
      guard let self, case .idle = updatePhase, !dragController.isActive, let pendingUpdate else {
        return
      }
      self.pendingUpdate = nil
      process(pendingUpdate)
    }
  }

  private func handleActiveDragUpdate(_ update: Update) {
    let canApplyUpdate = if case .idle = updatePhase { true } else { false }
    switch dragController.disposition(
      for: update.outline,
      applied: appliedOutline,
      canApplyUpdate: canApplyUpdate
    ) {
    case .inactive, .unchanged:
      return
    case .queue:
      queue(update)
    case .queueAndReconcile:
      queue(update)
      reconcileCompletedDrop()
    case .replaceAndCancel(let reason):
      applyIncompatibleSnapshotAndCancel(update, reason: reason)
    }
  }

  private func reconcileCompletedDrop() {
    let candidate = reconciliationCandidate()
    guard let disposition = dragController.snapshotDisposition(for: candidate.outline) else { return }
    switch disposition {
    case .waiting, .rejected:
      return
    case .exact:
      if candidate.isPending {
        pendingUpdate = nil
        applySnapshot(candidate.update, animated: false) { [weak self] in
          self?.dragController.recordSnapshot(.exact, outline: candidate.outline)
        }
      } else {
        dragController.recordSnapshot(.exact, outline: candidate.outline)
      }
    case .superseding:
      dragController.stopDropTargetPresentation()
      if candidate.isPending {
        pendingUpdate = nil
        applySnapshot(candidate.update, animated: false) { [weak self] in
          self?.dragController.recordSnapshot(.superseding, outline: candidate.outline)
        }
      } else {
        dragController.recordSnapshot(.superseding, outline: candidate.outline)
      }
    case .incompatible:
      if candidate.isPending {
        applyIncompatibleSnapshotAndCancel(candidate.update, reason: "receiptSnapshotMismatch")
      } else {
        dragController.cancelTopologyChange(reason: "receiptSnapshotMismatch")
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

  private func applyIncompatibleSnapshotAndCancel(_ update: Update, reason: String) {
    guard let operationID = dragController.operationID else { return }
    pendingUpdate = nil
    applySnapshot(update, animated: false) { [weak self] in
      self?.dragController.cancelTopologyChange(reason: reason, operationID: operationID)
    }
  }

  private func preferredHeight(for id: TerminalSidebarEntryID, width: CGFloat) -> CGFloat {
    if case .pinDivider = id { return TerminalSidebarLayoutPlan.dividerHeight }
    if case .newTab = id { return TerminalSidebarLayout.newTabRowHeight }
    guard let presentation = rows[id], let context else {
      return TerminalSidebarLayout.tabRowMinHeight
    }
    if case .group = presentation { return TerminalSidebarLayout.tabRowMinHeight }
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
      item.host(TerminalSidebarHostedRow(presentation: presentation, context: context))
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

    for _ in 0..<2 {
      layoutViewportAndCollection()
      let shouldPin = TerminalSidebarNewTabPlacement.shouldPin(
        itemFrame: collectionLayout.plan.items.first { $0.id == .newTab }?.frame,
        visibleRect: scrollView.documentVisibleRect,
        pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
        isPinned: dragController.pinnedControl.isPinned
      )
      let placementChanged = dragController.pinnedControl.setPinned(shouldPin)
      collectionLayout.isNewTabItemHidden = shouldPin
      guard placementChanged else { break }
    }

    updateDecorations()
    updateGroupHover(at: collectionView.pointerLocation)
  }

  private func layoutViewportAndCollection() {
    let viewportLayout = TerminalSidebarViewportLayout(
      bounds: view.bounds,
      pinnedControlHeight: dragController.pinnedControl.height
    )
    dragController.pinnedControl.layout(in: viewportLayout.pinnedControlFrame)
    scrollView.frame = viewportLayout.scrollViewportFrame
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
  }

  private func updateDecorations() {
    let groups = collectionLayout.plan.groups
    let visibleIDs = Set(groups.map(\.id))
    let liftedGroupID = dragController.liftedGroupID
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
    updateSelectionGlow()
    collectionView.addSubview(selectionGlowView, positioned: .below, relativeTo: nil)
    for background in groupBackgroundViews.values where background.superview === collectionView {
      collectionView.addSubview(background, positioned: .below, relativeTo: nil)
    }
  }

  private func updateSelectionGlow() {
    guard
      let selectedTabID,
      let context,
      let item = collectionLayout.plan.items.first(where: { $0.id == .tab(selectedTabID) }),
      case .tab(let presentation) = rows[.tab(selectedTabID)],
      item.alpha > 0,
      !item.frame.isEmpty
    else {
      selectionGlowView.isHidden = true
      return
    }
    selectionGlowView.update(
      surfaceFrame: TerminalSidebarLayout.tabSurfaceFrame(
        in: item.frame,
        isGrouped: presentation.groupID != nil
      ),
      color: context.palette.selectableRow.shadow,
      alpha: item.alpha,
      isDark: context.palette.isDark
    )
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
      ?? (!dragController.isActive ? point.flatMap(collectionLayout.plan.groupID(at:)) : nil)
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
      let entry = appliedOutline.visibleEntries.first(where: { $0.id == entryID }),
      let frame = collectionLayout.targetPlan.revealFrame(for: entry)
    else { return }
    let revealFrame = frame.insetBy(dx: 0, dy: -SelectableRowShadowMetrics.visualOutset)
    let visibleRect = collectionView.visibleRect
    guard visibleRect.height >= TerminalSidebarLayout.tabRowMinHeight else { return }
    if visibleRect.contains(revealFrame) {
      pendingRevealTabID = nil
      return
    }
    collectionView.scrollToVisible(revealFrame)
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

  private func accessibilityIdentifier(for presentation: TerminalSidebarRowPresentation) -> String {
    TerminalSidebarAccessibilityIdentifier.row(presentation)
  }

  @objc private func liveScrollDidStart() {
    dragController.setLiveScrolling(true)
  }

  @objc private func liveScrollDidEnd() {
    dragController.setLiveScrolling(false)
  }

  @objc private func scrollViewDidScroll() {
    guard !isLayingOut else { return }
    view.needsLayout = true
    view.layoutSubtreeIfNeeded()
  }
}
