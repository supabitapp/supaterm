import AppKit
import SupaTheme
import SwiftUI

@MainActor
final class TerminalSidebarControllerCache {
  private var controllersBySpaceID: [TerminalSpaceID: TerminalSidebarListController] = [:]
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  var hoverCardRetentionChanged: (() -> Void)?

  init(
    windowControllerID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?
  ) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
    self.captureRequest = captureRequest
  }

  var count: Int {
    controllersBySpaceID.count
  }

  var isHoverCardPresented: Bool {
    controllersBySpaceID.values.contains(where: \.isHoverCardPresented)
  }

  func controller(for spaceID: TerminalSpaceID) -> TerminalSidebarListController {
    if let controller = controllersBySpaceID[spaceID] {
      return controller
    }
    let controller = TerminalSidebarListController(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry,
      captureRequest: captureRequest
    )
    controller.hoverCardPresentationChanged = { [weak self] in
      self?.hoverCardRetentionChanged?()
    }
    controllersBySpaceID[spaceID] = controller
    return controller
  }

  func retain(_ spaceIDs: [TerminalSpaceID]) {
    let retained = Set(spaceIDs)
    for (spaceID, controller) in controllersBySpaceID where !retained.contains(spaceID) {
      controller.dismissHoverCard()
    }
    controllersBySpaceID = controllersBySpaceID.filter { retained.contains($0.key) }
  }

  func dismissHoverCards() {
    for controller in controllersBySpaceID.values {
      controller.dismissHoverCard()
    }
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
final class TerminalSidebarListController: NSViewController {
  private struct Update {
    let outline: TerminalSidebarOutline
    let reduceMotion: Bool
  }

  private struct PendingDropHandoff {
    let requirement: TerminalSidebarDropHandoff
    let completion: TerminalSidebarDragController.DropHandoffCompletion
  }

  private enum UpdateState {
    case idle
    case collapsing(Update)
    case applyingSnapshot(Update?)
    case queued(Update)
    case handoff(PendingDropHandoff, Update?)
    case settlement(TerminalSidebarDropSettlementPreparation, Update?)
  }

  let renameState = TerminalSidebarRenameState()
  let groupHoverState = TerminalSidebarGroupHoverState()
  let groupHeaderHoverState = TerminalSidebarGroupHoverState()
  let tabSelectionState = TerminalSidebarTabSelectionState()
  var hoverCardPresentationChanged: (() -> Void)?
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
  private var appliedOutline = TerminalSidebarOutline(
    roots: [],
    collapsedGroupIDs: [],
    topologyRevision: 0
  )
  private var updateState = UpdateState.idle
  private var hasAppliedSnapshot = false
  private var selectedTabID: TerminalTabID?
  private var fixedHoveredGroupID: TerminalTabGroupID?
  private var pendingRevealTabID: TerminalTabID?
  private var trackingMenuIDs: Set<ObjectIdentifier> = []
  private var pendingVisibleRowRefreshIDs: Set<TerminalSidebarEntryID> = []
  private var motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: false)
  private var shouldPlayTabMoveHaptics = true
  private var isLayingOut = false
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  private lazy var hoverCardController = TerminalSidebarHoverCardController(
    tabAtPoint: { [weak self] screenPoint in
      guard let self, let window = collectionView.window else { return nil }
      let windowPoint = window.convertFromScreen(CGRect(origin: screenPoint, size: .zero)).origin
      let point = collectionView.convert(windowPoint, from: nil)
      guard
        TerminalSidebarHoverCardGeometry.isPointVisible(
          point,
          visibleRect: collectionView.visibleRect
        )
      else { return nil }
      return hoveredTabID(at: point)
    },
    sourceForTab: { [weak self] tabID in self?.hoverCardSource(for: tabID) },
    content: { [weak self] tabID in self?.hoverCardContent(for: tabID) },
    allowsPresentation: { [weak self] in self?.allowsHoverCardPresentation == true },
    reduceMotion: { [weak self] in self?.motionPolicy.reduceMotion == true }
  )

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
  private lazy var dragController = TerminalSidebarDragController(
    collectionView: collectionView,
    collectionLayout: collectionLayout,
    layoutAnimator: layoutAnimator,
    scrollView: scrollView,
    sourceSurfaceView: view,
    sourceWindowID: windowControllerID,
    tabDragRegistry: tabDragRegistry,
    captureRequest: captureRequest,
    host: TerminalSidebarDragController.Host(
      content: { [weak self] in
        guard let self, let context else { return nil }
        let canBeginDrag = if case .idle = updateState { true } else { false }
        return TerminalSidebarDragController.Content(
          outline: appliedOutline,
          selectedTabID: selectedTabID,
          rows: rows,
          context: context,
          motionPolicy: motionPolicy,
          shouldPlayTabMoveHaptics: shouldPlayTabMoveHaptics,
          canBeginDrag: canBeginDrag,
          swipe: swipe
        )
      },
      indexPath: { [weak self] in self?.dataSource?.indexPath(for: $0) },
      invalidateLayout: { [weak self] in self?.invalidateLayout() },
      rebindRows: { [weak self] in self?.refreshVisibleRows(ids: $0) },
      didBegin: { [weak self] in self?.hoverCardController.dismiss() },
      didFinish: { [weak self] in self?.consumePendingUpdate() },
      prepareDropSettlement: { [weak self] in self?.prepareDropSettlement($0) },
      completeDropHandoff: { [weak self] requirement, completion in
        self?.completeDropHandoff(requirement, completion: completion)
      },
      setHoveredGroupID: { [weak self] in self?.setHoveredGroupID($0) }
    )
  )

  init(
    windowControllerID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?
  ) {
    self.windowControllerID = windowControllerID
    self.tabDragRegistry = tabDragRegistry
    self.captureRequest = captureRequest
    super.init(nibName: nil, bundle: nil)
    let center = NotificationCenter.default
    center.addObserver(
      self,
      selector: #selector(menuDidBeginTracking(_:)),
      name: NSMenu.didBeginTrackingNotification,
      object: nil
    )
    center.addObserver(
      self,
      selector: #selector(menuDidEndTracking(_:)),
      name: NSMenu.didEndTrackingNotification,
      object: nil
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  isolated deinit {
    NotificationCenter.default.removeObserver(self)
  }

  override func loadView() {
    view = NSView()
    hoverCardController.presentationChanged = { [weak self] in
      self?.hoverCardPresentationChanged?()
    }
    configureHierarchy()
  }

  var isHoverCardPresented: Bool {
    hoverCardController.isPresented
  }

  func dismissHoverCard() {
    hoverCardController.dismiss()
  }

  override func viewWillLayout() {
    super.viewWillLayout()
    layoutHierarchy()
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    revealSelectedTabIfNeeded()
  }

  func apply(
    outline: TerminalSidebarOutline,
    rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation],
    context: TerminalSidebarRowContext,
    selectedTabID: TerminalTabID?,
    interactionPolicy: TerminalSidebarInteractionPolicy
  ) {
    self.rows = rows
    self.context = context
    shouldPlayTabMoveHaptics = interactionPolicy.shouldPlayTabMoveHaptics
    hoverCardController.refresh()
    dragController.pinnedControl.update(context: context)
    fixedHoveredGroupID = context.fixedHoveredGroupID
    updateMotionPolicy(reduceMotion: interactionPolicy.reduceMotion)
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
    if selectedTabID != self.selectedTabID {
      tabSelectionState.clear()
      self.selectedTabID = selectedTabID
      pendingRevealTabID = selectedTabID
    }
    tabSelectionState.retainVisible(in: outline, primaryTabID: selectedTabID)

    refreshVisibleRows(ids: Set(rows.keys))
    let update = Update(outline: outline, reduceMotion: interactionPolicy.reduceMotion)
    if dragController.isActive {
      handleActiveDragUpdate(update)
      return
    }
    if case .handoff = updateState {
      queue(update)
      consumeDropHandoffUpdate()
      return
    }
    switch updateState {
    case .idle:
      break
    case .collapsing(let activeUpdate):
      guard activeUpdate.outline != update.outline || update.reduceMotion else { return }
      _ = endCollapse()
    case .applyingSnapshot, .queued, .settlement:
      queue(update)
      consumePendingUpdate()
      return
    case .handoff:
      preconditionFailure()
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
    collectionView.addSubview(selectionGlowView, positioned: .below, relativeTo: nil)
    collectionView.onPointerMoved = { [weak self] point in
      self?.updateGroupHover(at: point)
      self?.hoverCardController.pointerMoved()
    }
    collectionView.onPointerExited = { [weak self] in
      self?.updateGroupHover(at: nil)
      self?.hoverCardController.pointerExited()
    }
    collectionView.onWindowChanged = { [weak self] window in
      guard window == nil else { return }
      self?.hoverCardController.dismiss()
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
        entryID: entryID,
        TerminalSidebarHostedRow(presentation: presentation, context: context)
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
    updateMotionPolicy(reduceMotion: update.reduceMotion)
    let newlyCollapsedGroupIDs = update.outline.collapsedGroupIDs.subtracting(
      appliedOutline.collapsedGroupIDs
    )
    let targetEntryIDs = Set(update.outline.visibleEntries.map(\.id))
    let collapsing = appliedOutline.visibleEntries.compactMap { entry -> TerminalSidebarEntryID? in
      guard let groupID = entry.parentGroupID,
        newlyCollapsedGroupIDs.contains(groupID),
        !targetEntryIDs.contains(entry.id)
      else {
        return nil
      }
      return entry.id
    }
    if !collapsing.isEmpty, motionPolicy.collapseStagger,
      !dataSource.snapshot().itemIdentifiers.isEmpty
    {
      layoutAnimator.finish()
      updateState = .collapsing(update)
      collectionLayout.beginCollapse()
      collapseAnimator.start(rowIDs: collapsing)
      return
    }
    applySnapshot(
      update,
      animated: !dataSource.snapshot().itemIdentifiers.isEmpty && motionPolicy.targetInterpolation
    )
  }

  private func updateMotionPolicy(reduceMotion: Bool) {
    let wasTargetInterpolationEnabled = motionPolicy.targetInterpolation
    motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: reduceMotion)
    guard wasTargetInterpolationEnabled, !motionPolicy.targetInterpolation else { return }
    layoutAnimator.finish()
    invalidateLayout()
  }

  private func completeCollapse() {
    guard let update = endCollapse() else { return }
    applySnapshot(update, animated: false)
  }

  private func endCollapse() -> Update? {
    guard case .collapsing(let update) = updateState else { return nil }
    collapseAnimator.cancel()
    collectionLayout.endCollapse()
    updateState = .idle
    return update
  }

  private func applySnapshot(
    _ update: Update,
    animated: Bool,
    completion additionalCompletion: (() -> Void)? = nil
  ) {
    let isInitialSnapshot = !hasAppliedSnapshot
    let animatesExpansion =
      animated
      && !update.outline.expandedGroupIDs(from: appliedOutline).isEmpty
    updateState = .applyingSnapshot(nil)
    collectionLayout.visibilityByEntryID = [:]
    layoutAnimator.finish()
    var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
    snapshot.appendSections([0])
    snapshot.appendItems(update.outline.visibleEntries.map(\.id))
    let completion = { [weak self] in
      guard let self else { return }
      appliedOutline = update.outline
      hasAppliedSnapshot = true
      let pendingUpdate: Update?
      if case .applyingSnapshot(let update) = updateState {
        pendingUpdate = update
      } else {
        pendingUpdate = nil
      }
      updateState = pendingUpdate.map(UpdateState.queued) ?? .idle
      collectionLayout.finishStructuralUpdate()
      refreshVisibleRows(ids: Set(rows.keys))
      invalidateLayout()
      if collectionLayout.clearPinnedContentHeight(visibleRect: collectionView.visibleRect) {
        invalidateLayout()
      }
      additionalCompletion?()
      if isInitialSnapshot {
        let contentView = scrollView.contentView
        contentView.scroll(to: contentView.documentRect.origin)
        scrollView.reflectScrolledClipView(contentView)
      }
      revealSelectedTabIfNeeded()
      consumePendingUpdate()
    }
    if isInitialSnapshot {
      collectionLayout.setOutline(update.outline)
      dataSource.apply(snapshot, animatingDifferences: false)
      completion()
      return
    }
    if animatesExpansion {
      layoutAnimator.animate(enabled: true) {
        collectionLayout.setOutline(update.outline)
        dataSource.apply(snapshot, animatingDifferences: false, completion: completion)
      }
      return
    }
    if animated {
      collectionLayout.stageOutline(update.outline)
    } else {
      collectionLayout.setOutline(update.outline)
    }
    guard animated else {
      dataSource.apply(snapshot, animatingDifferences: false, completion: completion)
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = TerminalSidebarLayoutMotion.defaultDuration
      context.timingFunction = TerminalSidebarAnimationCurve.timingFunction
      dataSource.apply(snapshot, animatingDifferences: true, completion: completion)
    }
  }

  private func consumePendingUpdate() {
    Task { @MainActor [weak self] in
      guard let self, !dragController.isActive else { return }
      if case .handoff = updateState {
        consumeDropHandoffUpdate()
        return
      }
      guard case .queued(let update) = updateState else { return }
      updateState = .idle
      process(update)
    }
  }

  private func completeDropHandoff(
    _ requirement: TerminalSidebarDropHandoff,
    completion: @escaping TerminalSidebarDragController.DropHandoffCompletion
  ) {
    let handoff = PendingDropHandoff(
      requirement: requirement,
      completion: completion
    )
    switch updateState {
    case .idle:
      updateState = .handoff(handoff, nil)
    case .queued(let update):
      updateState = .handoff(handoff, update)
    case .collapsing, .applyingSnapshot, .handoff, .settlement:
      preconditionFailure()
    }
    consumeDropHandoffUpdate()
  }

  private func consumeDropHandoffUpdate() {
    guard
      !dragController.isActive,
      case .handoff(let handoff, let update?) = updateState,
      handoff.requirement.accepts(update.outline.topologyStamp)
    else { return }
    updateState = .idle
    applySnapshot(update, animated: false, completion: handoff.completion)
  }

  private func handleActiveDragUpdate(_ update: Update) {
    let canApplyUpdate = if case .idle = updateState { true } else { false }
    switch dragController.disposition(
      for: update.outline,
      applied: appliedOutline,
      canApplyUpdate: canApplyUpdate
    ) {
    case .inactive, .unchanged:
      return
    case .queue:
      queue(update)
      consumeDropSettlementUpdate()
    case .replaceAndCancel(let reason):
      queue(update)
      dragController.cancelTopologyChange(reason: reason)
    }
  }

  private func prepareDropSettlement(_ settlement: TerminalSidebarDropSettlementPreparation) {
    switch updateState {
    case .idle:
      updateState = .settlement(settlement, nil)
    case .queued(let update):
      updateState = .settlement(settlement, update)
    case .collapsing, .applyingSnapshot, .handoff, .settlement:
      preconditionFailure()
    }
    consumeDropSettlementUpdate()
  }

  private func consumeDropSettlementUpdate() {
    guard
      dragController.isActive,
      case .settlement(let settlement, let update?) = updateState,
      settlement.requirement.accepts(update.outline.topologyStamp)
    else { return }
    updateState = .idle
    settlement.applyLayout()
    applySnapshot(update, animated: false, completion: settlement.completion)
  }

  private func queue(_ update: Update) {
    switch updateState {
    case .idle:
      updateState = .queued(update)
    case .collapsing:
      preconditionFailure()
    case .applyingSnapshot(let current):
      updateState = .applyingSnapshot(preferredUpdate(current, update))
    case .queued(let current):
      updateState = .queued(preferredUpdate(current, update))
    case .handoff(let handoff, let current):
      updateState = .handoff(
        handoff,
        preferredUpdate(current, update, requirement: handoff.requirement)
      )
    case .settlement(let settlement, let current):
      updateState = .settlement(
        settlement,
        preferredUpdate(current, update, requirement: settlement.requirement)
      )
    }
  }

  private func preferredUpdate(
    _ current: Update?,
    _ next: Update,
    requirement: TerminalSidebarDropHandoff? = nil
  ) -> Update {
    guard let current else { return next }
    if let requirement {
      let currentAccepted = requirement.accepts(current.outline.topologyStamp)
      let nextAccepted = requirement.accepts(next.outline.topologyStamp)
      if currentAccepted != nextAccepted { return nextAccepted ? next : current }
    }
    guard
      let currentStamp = current.outline.topologyStamp,
      let nextStamp = next.outline.topologyStamp,
      currentStamp.spaceID == nextStamp.spaceID
    else {
      return next
    }
    return nextStamp.revision >= currentStamp.revision ? next : current
  }

  private func preferredHeight(for id: TerminalSidebarEntryID, width _: CGFloat) -> CGFloat {
    if case .pinDivider = id { return TerminalSidebarLayoutPlan.dividerHeight }
    return TerminalSidebarLayout.tabRowMinHeight
  }

  private func refreshVisibleRows(ids: Set<TerminalSidebarEntryID>) {
    guard !ids.isEmpty else { return }
    guard trackingMenuIDs.isEmpty else {
      pendingVisibleRowRefreshIDs.formUnion(ids)
      return
    }
    guard let context else { return }
    for item in collectionView.visibleItems() {
      guard
        let item = item as? TerminalSidebarCollectionItem,
        let id = item.entryID,
        ids.contains(id),
        let presentation = rows[id]
      else { continue }
      item.host(
        entryID: id,
        TerminalSidebarHostedRow(presentation: presentation, context: context)
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

    for _ in 0..<2 {
      layoutViewportAndCollection()
      guard updateNewTabPlacement() else { break }
    }

    updateDecorations()
    updateGroupHover(at: collectionView.pointerLocation)
  }

  private func updateNewTabPlacement() -> Bool {
    let shouldPin = TerminalSidebarNewTabPlacement.shouldPin(
      itemFrame: collectionLayout.plan.items.first { $0.id == .newTab }?.frame,
      visibleRect: scrollView.documentVisibleRect,
      pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
      isPinned: dragController.pinnedControl.isPinned
    )
    let placementChanged = dragController.pinnedControl.setPinned(shouldPin)
    collectionLayout.isNewTabItemHidden = shouldPin
    return placementChanged
  }

  private func layoutViewportAndCollection() {
    let viewportLayout = TerminalSidebarViewportLayout(
      bounds: view.bounds,
      pinnedControlHeight: dragController.pinnedControl.height
    )
    dragController.pinnedControl.layout(in: viewportLayout.pinnedControlFrame)
    if scrollView.frame != viewportLayout.scrollViewportFrame {
      scrollView.frame = viewportLayout.scrollViewportFrame
    }
    scrollView.tile()
    let documentWidth = max(1, scrollView.contentView.bounds.width)
    let viewportHeight = max(1, scrollView.contentView.bounds.height)
    let initialCollectionSize = CGSize(
      width: documentWidth,
      height: max(viewportHeight, collectionView.frame.height)
    )
    if collectionView.frame.size != initialCollectionSize {
      collectionView.setFrameSize(initialCollectionSize)
    }
    collectionLayout.invalidateLayout()
    collectionLayout.prepare()
    let contentSize = CGSize(
      width: documentWidth,
      height: max(viewportHeight, collectionLayout.collectionViewContentSize.height)
    )
    if collectionView.frame.size != contentSize {
      collectionView.setFrameSize(contentSize)
    }
  }

  private func updateDecorations() {
    let groups = collectionLayout.plan.groups
    let visibleIDs = Set(groups.map(\.id))
    for (id, view) in groupBackgroundViews where !visibleIDs.contains(id) {
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
      let context,
      let selectedTabID = context.terminal.selectedTabID ?? selectedTabID,
      let item = collectionLayout.plan.items.first(where: { $0.id == .tab(selectedTabID) }),
      case .tab(let presentation) = rows[.tab(selectedTabID)],
      item.alpha > 0,
      !item.frame.isEmpty
    else {
      selectionGlowView.isHidden = true
      return
    }
    let surfaceFrame = TerminalSidebarLayout.tabSurfaceFrame(
      in: item.frame,
      isGrouped: presentation.groupID != nil
    )
    selectionGlowView.update(
      surfaceFrame: surfaceFrame,
      style: .resolve(palette: context.palette),
      alpha: item.alpha,
      fadesAtContentTop: true
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

  private var allowsHoverCardPresentation: Bool {
    guard view.window?.isKeyWindow == true, !dragController.isActive else { return false }
    if case .handoff = updateState { return false }
    return true
  }

  private func hoveredTabID(at point: CGPoint) -> TerminalTabID? {
    guard let indexPath = collectionView.indexPathForItem(at: point),
      let entryID = dataSource.itemIdentifier(for: indexPath),
      case .tab(let tabID) = entryID
    else { return nil }
    return tabID
  }

  private func hoverCardSource(
    for tabID: TerminalTabID
  ) -> TerminalSidebarHoverCardController.Source? {
    let entryID = TerminalSidebarEntryID.tab(tabID)
    guard let indexPath = dataSource.indexPath(for: entryID),
      let item = collectionView.item(at: indexPath) as? TerminalSidebarCollectionItem,
      item.entryID == entryID,
      !item.view.isHidden,
      item.view.window != nil
    else { return nil }
    return TerminalSidebarHoverCardController.Source(view: item.view)
  }

  private func hoverCardContent(for tabID: TerminalTabID) -> TerminalSidebarHoverCardContent? {
    guard let context,
      case .tab(let presentation) = rows[.tab(tabID)]
    else { return nil }
    let agentContext = context.terminal.tabAgentContext(for: tabID)
    let workingDirectoryPath = context.terminal.titleSurface(for: tabID).flatMap {
      context.terminal.workingDirectoryPath(for: $0)
    }
    let workspace = agentContext.workspaces.first
    return TerminalSidebarHoverCardContent(
      tabTitle: presentation.tab.title,
      workingDirectoryPath: workspace?.workingDirectoryPath ?? workingDirectoryPath,
      branch: workspace?.branch,
      response: agentContext.presentation.latestResponse
    )
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

  private func accessibilityIdentifier(for presentation: TerminalSidebarRowPresentation) -> String {
    TerminalSidebarAccessibilityIdentifier.row(presentation)
  }

  @objc private func liveScrollDidStart() {
    hoverCardController.dismiss()
    dragController.setLiveScrolling(true)
  }

  @objc private func liveScrollDidEnd() {
    dragController.setLiveScrolling(false)
  }

  @objc private func scrollViewDidScroll() {
    guard !isLayingOut else { return }
    hoverCardController.dismiss()
    let clearedContentHeight = collectionLayout.clearPinnedContentHeight(
      visibleRect: collectionView.visibleRect
    )
    let placementChanged = updateNewTabPlacement()
    guard clearedContentHeight || placementChanged else {
      updateGroupHover(at: collectionView.pointerLocation)
      return
    }
    invalidateLayout()
  }

  @objc private func menuDidBeginTracking(_ notification: Notification) {
    guard let menu = notification.object as? NSMenu else { return }
    trackingMenuIDs.insert(ObjectIdentifier(menu))
  }

  @objc private func menuDidEndTracking(_ notification: Notification) {
    guard let menu = notification.object as? NSMenu else { return }
    trackingMenuIDs.remove(ObjectIdentifier(menu))
    guard trackingMenuIDs.isEmpty, !pendingVisibleRowRefreshIDs.isEmpty else { return }
    let ids = pendingVisibleRowRefreshIDs
    pendingVisibleRowRefreshIDs.removeAll()
    refreshVisibleRows(ids: ids)
  }
}
