import AppKit
import QuartzCore
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

  private struct RowMeasurement {
    let width: CGFloat
    let key: AnyHashable
    let height: CGFloat
  }

  private struct PendingDropHandoff {
    let requirement: TerminalSidebarDropHandoff
    let completion: TerminalSidebarDragController.DropHandoffCompletion
  }

  private enum UpdatePhase {
    case idle
    case collapsing(Update)
    case applyingSnapshot
  }

  let renameState = TerminalSidebarRenameState()
  let projectHoverState = TerminalSidebarProjectHoverState()
  let projectHeaderHoverState = TerminalSidebarProjectHoverState()
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
  private var projectBackgroundViews: [TerminalProjectID: TerminalSidebarProjectBackgroundView] = [:]
  private var dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>!
  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
  private var context: TerminalSidebarRowContext?
  private var measuredHeights: [TerminalSidebarEntryID: RowMeasurement] = [:]
  private var appliedOutline = TerminalSidebarOutline(
    roots: [],
    collapsedProjectIDs: [],
    topologyRevision: 0
  )
  private var pendingUpdate: Update?
  private var pendingDropHandoff: PendingDropHandoff?
  private var updatePhase = UpdatePhase.idle
  private var hasAppliedSnapshot = false
  private var selectedTabID: TerminalTabID?
  private var fixedHoveredProjectID: TerminalProjectID?
  private var pendingRevealTabID: TerminalTabID?
  private var motionPolicy = TerminalSidebarMotionPolicy(reduceMotion: false)
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
        let canBeginDrag = if case .idle = updatePhase { pendingDropHandoff == nil } else { false }
        return TerminalSidebarDragController.Content(
          outline: appliedOutline,
          selectedTabID: selectedTabID,
          rows: rows,
          context: context,
          motionPolicy: motionPolicy,
          canBeginDrag: canBeginDrag,
          swipe: swipe,
          projectBackgroundViews: projectBackgroundViews
        )
      },
      indexPath: { [weak self] in self?.dataSource?.indexPath(for: $0) },
      invalidateLayout: { [weak self] in self?.invalidateLayout() },
      rebindRows: { [weak self] in self?.refreshVisibleRows(ids: $0) },
      didBegin: { [weak self] in self?.hoverCardController.dismiss() },
      didFinish: { [weak self] in self?.consumePendingUpdate() },
      completeDropHandoff: { [weak self] requirement, completion in
        self?.completeDropHandoff(requirement, completion: completion)
      },
      setHoveredProjectID: { [weak self] in self?.setHoveredProjectID($0) }
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
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
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
    reduceMotion: Bool
  ) {
    self.rows = rows
    self.context = context
    hoverCardController.refresh()
    dragController.pinnedControl.update(context: context)
    fixedHoveredProjectID = context.fixedHoveredProjectID
    updateMotionPolicy(reduceMotion: reduceMotion)
    let projectIDs = Set(
      outline.roots.compactMap { root -> TerminalProjectID? in
        guard case .project(let id, _, _) = root.content else { return nil }
        return id
      }
    )
    projectHoverState.retain(projectIDs)
    projectHeaderHoverState.retain(projectIDs)
    if let fixedHoveredProjectID = context.fixedHoveredProjectID,
      projectIDs.contains(fixedHoveredProjectID)
    {
      projectHoverState.set(fixedHoveredProjectID)
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
    if pendingDropHandoff != nil {
      queue(update)
      consumeDropHandoffUpdate()
      return
    }
    switch updatePhase {
    case .idle:
      break
    case .collapsing(let activeUpdate):
      guard activeUpdate.outline != update.outline || update.reduceMotion else { return }
      _ = endCollapse()
      pendingUpdate = nil
    case .applyingSnapshot:
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
    collectionView.addSubview(selectionGlowView, positioned: .below, relativeTo: nil)
    collectionView.onPointerMoved = { [weak self] point in
      self?.updateProjectHover(at: point)
      self?.hoverCardController.pointerMoved()
    }
    collectionView.onPointerExited = { [weak self] in
      self?.updateProjectHover(at: nil)
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
    let newlyCollapsedProjectIDs = update.outline.collapsedProjectIDs.subtracting(
      appliedOutline.collapsedProjectIDs
    )
    let collapsing = appliedOutline.visibleEntries.compactMap { entry -> TerminalSidebarEntryID? in
      guard let projectID = entry.parentProjectID, newlyCollapsedProjectIDs.contains(projectID) else {
        return nil
      }
      return entry.id
    }
    if !collapsing.isEmpty, motionPolicy.collapseStagger,
      !dataSource.snapshot().itemIdentifiers.isEmpty
    {
      updatePhase = .collapsing(update)
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
    guard case .collapsing(let update) = updatePhase else { return nil }
    collapseAnimator.cancel()
    collectionLayout.endCollapse()
    updatePhase = .idle
    return update
  }

  private func applySnapshot(
    _ update: Update,
    animated: Bool,
    completion additionalCompletion: (() -> Void)? = nil
  ) {
    let isInitialSnapshot = !hasAppliedSnapshot
    let animationDuration = TerminalSidebarLayoutMotion.animationDuration(
      from: appliedOutline,
      to: update.outline
    )
    updatePhase = .applyingSnapshot
    collectionLayout.visibilityByEntryID = [:]
    layoutAnimator.animate(enabled: animated, duration: animationDuration) {
      collectionLayout.setOutline(update.outline)
    }
    var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
    snapshot.appendSections([0])
    snapshot.appendItems(update.outline.visibleEntries.map(\.id))
    let completion = { [weak self] in
      guard let self else { return }
      appliedOutline = update.outline
      hasAppliedSnapshot = true
      updatePhase = .idle
      collectionLayout.finishStructuralUpdate()
      refreshVisibleRows(ids: Set(rows.keys))
      additionalCompletion?()
      invalidateLayout()
      if isInitialSnapshot {
        let contentView = scrollView.contentView
        contentView.scroll(to: contentView.documentRect.origin)
        scrollView.reflectScrolledClipView(contentView)
      }
      revealSelectedTabIfNeeded()
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
      context.duration = animationDuration
      context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
      dataSource.apply(snapshot, animatingDifferences: true, completion: completion)
    }
  }

  private func consumePendingUpdate() {
    Task { @MainActor [weak self] in
      guard let self, case .idle = updatePhase, !dragController.isActive else { return }
      if pendingDropHandoff != nil {
        consumeDropHandoffUpdate()
        return
      }
      guard let pendingUpdate else { return }
      self.pendingUpdate = nil
      process(pendingUpdate)
    }
  }

  private func completeDropHandoff(
    _ requirement: TerminalSidebarDropHandoff,
    completion: @escaping TerminalSidebarDragController.DropHandoffCompletion
  ) {
    precondition(pendingDropHandoff == nil)
    pendingDropHandoff = PendingDropHandoff(
      requirement: requirement,
      completion: completion
    )
    consumeDropHandoffUpdate()
  }

  private func consumeDropHandoffUpdate() {
    guard
      case .idle = updatePhase,
      !dragController.isActive,
      let handoff = pendingDropHandoff,
      let update = pendingUpdate,
      handoff.requirement.accepts(update.outline.topologyStamp)
    else { return }
    pendingDropHandoff = nil
    pendingUpdate = nil
    applySnapshot(update, animated: false, completion: handoff.completion)
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
    case .replaceAndCancel(let reason):
      queue(update)
      dragController.cancelTopologyChange(reason: reason)
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

  private func preferredHeight(for id: TerminalSidebarEntryID, width: CGFloat) -> CGFloat {
    if case .pinDivider = id { return TerminalSidebarLayoutPlan.dividerHeight }
    if case .newTab = id { return TerminalSidebarLayout.newTabRowHeight }
    guard let presentation = rows[id], let context else {
      return TerminalSidebarLayout.tabRowMinHeight
    }
    if case .project = presentation { return TerminalSidebarLayout.tabRowMinHeight }
    if case .unassigned = presentation { return TerminalSidebarLayout.tabRowMinHeight }
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
    updateProjectHover(at: collectionView.pointerLocation)
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
    let projects = collectionLayout.plan.projects
    let visibleIDs = Set(projects.map(\.id))
    let liftedProjectID = dragController.liftedProjectID
    for (id, view) in projectBackgroundViews
    where !visibleIDs.contains(id) && id != liftedProjectID {
      view.removeFromSuperview()
      projectBackgroundViews[id] = nil
    }
    for project in projects {
      let background =
        projectBackgroundViews[project.id]
        ?? {
          let background = TerminalSidebarProjectBackgroundView(frame: .zero)
          collectionView.addSubview(background, positioned: .below, relativeTo: nil)
          projectBackgroundViews[project.id] = background
          return background
        }()
      background.frame = project.frame
      updateProjectSurface(project: project, background: background)
      background.needsLayout = true
    }
    updateSelectionGlow()
    collectionView.addSubview(selectionGlowView, positioned: .below, relativeTo: nil)
    for background in projectBackgroundViews.values where background.superview === collectionView {
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
        isProjected: presentation.projectID != nil
      ),
      style: .resolve(palette: context.palette),
      alpha: item.alpha,
      fadesAtContentTop: true
    )
  }

  private func refreshProjectSurfaces(ids: Set<TerminalProjectID>) {
    for id in ids {
      guard
        let project = collectionLayout.plan.projects.first(where: { $0.id == id }),
        let background = projectBackgroundViews[id]
      else { continue }
      updateProjectSurface(project: project, background: background)
    }
  }

  private func updateProjectHover(at point: CGPoint?) {
    let projectID =
      fixedHoveredProjectID
      ?? (!dragController.isActive ? point.flatMap(collectionLayout.plan.projectID(at:)) : nil)
    setHoveredProjectID(projectID)
  }

  private var allowsHoverCardPresentation: Bool {
    view.window?.isKeyWindow == true && !dragController.isActive && pendingDropHandoff == nil
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
    guard
      agentContext.presentation.status != nil
        || agentContext.presentation.detailActivity != nil
        || !agentContext.workspaces.isEmpty
        || agentContext.presentation.latestResponse != nil
    else { return nil }
    return TerminalSidebarHoverCardContent(
      tabTitle: presentation.tab.title,
      workspace: agentContext.workspaces.first,
      response: agentContext.presentation.latestResponse
    )
  }

  private func setHoveredProjectID(_ projectID: TerminalProjectID?) {
    guard projectHoverState.projectID != projectID else { return }
    let previous = projectHoverState.projectID
    projectHoverState.set(projectID)
    refreshProjectSurfaces(ids: Set([previous, projectID].compactMap { $0 }))
  }

  private func updateProjectSurface(
    project: TerminalSidebarLayoutPlan.Project,
    background: TerminalSidebarProjectBackgroundView
  ) {
    guard let context else { return }
    background.update(
      color: project.color,
      palette: context.palette,
      surfaceState: TerminalSidebarProjectSurfaceState.resolve(
        isHovered: projectHoverState.projectID == project.id,
        isDropTarget: collectionLayout.plan.highlightedProjectID == project.id
      ),
      alpha: project.alpha,
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
}
