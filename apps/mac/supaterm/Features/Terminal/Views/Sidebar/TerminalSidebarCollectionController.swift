import AppKit
import QuartzCore
import SupaTheme
import SwiftUI

final class TerminalSidebarInterItemGapView: NSView, NSCollectionViewElement {}

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

struct TerminalSidebarDropResult {
  let accepted: Bool
  let createdGroupID: TerminalTabGroupID?

  static let rejected = Self(accepted: false, createdGroupID: nil)

  static func accepted(createdGroupID: TerminalTabGroupID? = nil) -> Self {
    Self(accepted: true, createdGroupID: createdGroupID)
  }
}

@MainActor
final class TerminalSidebarListController: NSViewController, NSCollectionViewDelegate {
  private struct Update {
    let outline: TerminalSidebarOutline
    let reduceMotion: Bool
  }

  private struct AcceptedDrop {
    let drag: TerminalSidebarDragValue
    let destination: TerminalSidebarDropDestination
    let createdGroupID: TerminalTabGroupID?
  }

  private struct RowMeasurement {
    let width: CGFloat
    let key: AnyHashable
    let height: CGFloat
  }

  private struct ActiveDrag {
    let id: UUID
    let value: TerminalSidebarDragValue
    let sourceFrame: CGRect
    let hotspot: CGPoint
    var acceptedDrop: AcceptedDrop?
    var source: TerminalSidebarDragSessionSource?
    var watchdog: Task<Void, Never>?
  }

  private enum UpdatePhase {
    case idle
    case collapsing(Update)
    case applyingSnapshot
  }

  let renameState = TerminalSidebarRenameState()
  var onDrop: ((TerminalSidebarDragValue, TerminalSidebarDropDestination) -> TerminalSidebarDropResult)?

  private let scrollView = TerminalSidebarScrollView()
  private let collectionView = TerminalSidebarCollectionView()
  private let collectionLayout = TerminalSidebarCollectionLayout()
  private let dropIndicatorView = TerminalSidebarDropIndicatorView()
  private let combineHighlightView = TerminalSidebarDropHighlightView()
  private var groupBackgroundViews: [TerminalTabGroupID: TerminalSidebarGroupBackgroundView] = [:]
  private var dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>!
  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
  private var context: TerminalSidebarRowContext?
  private var measuredHeights: [TerminalSidebarEntryID: RowMeasurement] = [:]
  private var appliedOutline = TerminalSidebarOutline(roots: [], collapsedGroupIDs: [])
  private var pendingUpdate: Update?
  private var updatePhase = UpdatePhase.idle
  private var hasAppliedSnapshot = false
  private var selectedTabID: TerminalTabID?
  private var pendingRevealTabID: TerminalTabID?
  private var activeDrag: ActiveDrag?
  private var hapticTracker = TerminalSidebarHapticTargetTracker()
  private var previewPanel: TerminalSidebarDragPreviewPanel?
  private var animationsEnabled = true
  private var isLayingOut = false

  private lazy var collapseAnimator = TerminalSidebarCollapseAnimator(
    collectionView: collectionView,
    onFrame: { [weak self] visibility in
      self?.collectionLayout.visibilityByEntryID = visibility
      self?.invalidateLayout()
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
      refreshVisibleRows(ids: Set([previous, selectedTabID].compactMap { $0 }.map(TerminalSidebarEntryID.tab)))
    }

    refreshVisibleRows(ids: Set(rows.keys))
    let update = Update(
      outline: outline,
      reduceMotion: reduceMotion
    )

    if let accepted = activeDrag?.acceptedDrop,
      TerminalSidebarDropCommit.isApplied(
        drag: accepted.drag,
        destination: accepted.destination,
        outline: outline
      )
    {
      logDrag(
        "sidebar.drag.modelApplied",
        drag: accepted.drag,
        fields: destinationFields(accepted.destination)
      )
      pendingUpdate = update
      if let groupID = accepted.createdGroupID,
        let group = outline.group(groupID),
        case .group = group.content,
        let row = rows[.group(groupID)],
        case .group(let presentation) = row
      {
        renameState.begin(groupID: groupID, title: presentation.title)
      }
      settleDragging(accepted: true)
      return
    }

    if activeDrag != nil {
      if !outlineContainsActiveDrag(outline) {
        if let drag = activeDrag?.value {
          logDrag("sidebar.drag.sourceDisappeared", drag: drag)
        }
        pendingUpdate = update
        settleDragging(accepted: false)
      } else if outline != appliedOutline {
        pendingUpdate = update
      }
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
    collectionView.setDraggingSourceOperationMask(.move, forLocal: true)
    collectionView.delegate = self
    collectionView.addSubview(dropIndicatorView)
    collectionView.addSubview(combineHighlightView)
    collectionView.dragCandidate = { [weak self] location in
      self?.dragCandidate(at: location)
    }
    collectionView.onDragBegan = { [weak self] entryID, mouseDownEvent, dragEvent in
      self?.beginDragging(entryID: entryID, mouseDownEvent: mouseDownEvent, dragEvent: dragEvent)
        ?? false
    }
    collectionView.onDragExited = { [weak self] in
      self?.setDropTarget(nil, pointerY: nil)
    }

    dataSource = NSCollectionViewDiffableDataSource(collectionView: collectionView) {
      [weak self] collectionView, indexPath, entryID in
      guard
        let self,
        let presentation = self.rows[entryID],
        let context = self.context
      else { return nil }
      let item = collectionView.makeItem(
        withIdentifier: TerminalSidebarCollectionItem.identifier,
        for: indexPath
      )
      guard let item = item as? TerminalSidebarCollectionItem else { return nil }
      item.host(TerminalSidebarHostedRow(presentation: presentation, context: context))
      item.installDragRecognizer(from: self.collectionView)
      item.view.setAccessibilityElement(true)
      item.view.setAccessibilityRole(.row)
      item.view.setAccessibilityIdentifier(accessibilityIdentifier(for: presentation))
      return item
    }
    dataSource.supplementaryViewProvider = { _, kind, _ in
      Self.supplementaryView(for: kind)
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

  static func supplementaryView(
    for kind: NSCollectionView.SupplementaryElementKind
  ) -> TerminalSidebarInterItemGapView? {
    guard kind == NSCollectionView.elementKindInterItemGapIndicator else { return nil }
    return TerminalSidebarInterItemGapView()
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
    applySnapshot(update, animated: !dataSource.snapshot().itemIdentifiers.isEmpty && animationsEnabled)
  }

  private func completeCollapse() {
    guard case .collapsing(let update) = updatePhase else { return }
    updatePhase = .idle
    collectionLayout.visibilityByEntryID = [:]
    applySnapshot(update, animated: false)
  }

  private func applySnapshot(_ update: Update, animated: Bool) {
    let isInitialSnapshot = !hasAppliedSnapshot
    updatePhase = .applyingSnapshot
    collectionLayout.visibilityByEntryID = [:]
    collectionLayout.setEntries(update.outline.visibleEntries)
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

  private func dragCandidate(at location: CGPoint) -> TerminalSidebarDragCandidate? {
    guard
      case .idle = updatePhase,
      activeDrag == nil,
      let indexPath = collectionView.indexPathForItem(at: location),
      let id = dataSource.itemIdentifier(for: indexPath),
      let attributes = collectionLayout.layoutAttributesForItem(at: indexPath),
      location.x < attributes.frame.maxX - 28
    else { return nil }
    switch id {
    case .tab:
      return TerminalSidebarDragCandidate(entryID: id)
    case .group(let groupID):
      guard renameState.groupID != groupID else { return nil }
      return TerminalSidebarDragCandidate(entryID: id)
    case .emptyGroup, .pinDivider, .newTab, .newGroup:
      return nil
    }
  }

  private func beginDragging(
    entryID: TerminalSidebarEntryID,
    mouseDownEvent: NSEvent,
    dragEvent: NSEvent
  ) -> Bool {
    guard
      mouseDownEvent.window === dragEvent.window,
      case .idle = updatePhase,
      dataSource.snapshot().itemIdentifiers.contains(entryID)
    else { return false }
    let value: TerminalSidebarDragValue
    switch entryID {
    case .tab(let id): value = .tab(id)
    case .group(let id): value = .group(id)
    case .emptyGroup, .pinDivider, .newTab, .newGroup: return false
    }
    let sourceIDs = appliedOutline.visibleEntryIDs(for: value)
    guard
      let sourceFrame = collectionLayout.plan.items
        .filter({ sourceIDs.contains($0.id) && $0.frame.height > 0 })
        .map(\.frame)
        .reduce(Optional<CGRect>.none, { $0?.union($1) ?? $1 }),
      let context
    else { return false }
    let sourcePresentations = appliedOutline.visibleEntries.compactMap { entry in
      sourceIDs.contains(entry.id) ? rows[entry.id] : nil
    }
    let pointer = collectionView.convert(dragEvent.locationInWindow, from: nil)
    let hotspot = CGPoint(x: pointer.x - sourceFrame.minX, y: pointer.y - sourceFrame.minY)
    let sessionID = UUID()
    activeDrag = ActiveDrag(
      id: sessionID,
      value: value,
      sourceFrame: sourceFrame,
      hotspot: hotspot
    )
    logDrag(
      "sidebar.drag.started",
      drag: value,
      fields: [
        "pinnedRoots=\(appliedOutline.roots.filter(\.isPinned).count)",
        "regularRoots=\(appliedOutline.roots.filter { !$0.isPinned }.count)",
        "sourceMinY=\(coordinate(sourceFrame.minY))",
        "sourceMaxY=\(coordinate(sourceFrame.maxY))",
      ]
    )
    hapticTracker.reset()
    collectionLayout.draggedEntryIDs = sourceIDs
    previewPanel = TerminalSidebarDragPreviewPanel(
      presentations: sourcePresentations,
      context: context,
      groupColor: groupColor(for: value),
      size: sourceFrame.size
    )
    updatePreviewPosition(screenPoint: windowScreenPoint(for: dragEvent))
    previewPanel?.orderFront(nil)
    invalidateLayout()

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(value.pasteboardValue, forType: .terminalSidebarOutlineItem)
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      CGRect(origin: pointer, size: CGSize(width: 1, height: 1)), contents: NSImage(size: NSSize(width: 1, height: 1)))
    let source = TerminalSidebarDragSessionSource(
      onMoved: { [weak self] screenPoint in self?.updatePreviewPosition(screenPoint: screenPoint) },
      onEnded: { [weak self] source, screenPoint, operation in
        guard let self, activeDrag?.source === source else { return }
        activeDrag?.source = nil
        collectionView.finishDragGesture()
        draggingSessionEnded(sessionID: sessionID, screenPoint: screenPoint, operation: operation)
      }
    )
    activeDrag?.source = source
    let session = collectionView.beginDraggingSession(with: [draggingItem], event: dragEvent, source: source)
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
    return true
  }

  private func draggingSessionEnded(
    sessionID: UUID,
    screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    guard let activeDrag, activeDrag.id == sessionID else { return }
    autoscrollController.stop()
    logDrag(
      "sidebar.drag.ended",
      drag: activeDrag.value,
      fields: [
        "operation=\(operation.rawValue)",
        "nativeAccepted=\(activeDrag.acceptedDrop != nil)",
        "screenX=\(coordinate(screenPoint.x))",
        "screenY=\(coordinate(screenPoint.y))",
      ]
    )
    let recoveredDrop = activeDrag.acceptedDrop == nil && recoverDrop(at: screenPoint)
    guard self.activeDrag?.acceptedDrop != nil, operation == .move || recoveredDrop else {
      logDrag(
        "sidebar.drag.rejected",
        drag: activeDrag.value,
        fields: ["recovered=\(recoveredDrop)"]
      )
      settleDragging(accepted: false)
      return
    }
    self.activeDrag?.watchdog?.cancel()
    self.activeDrag?.watchdog = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      if let drag = self?.activeDrag?.value {
        self?.logDrag("sidebar.drag.commitTimedOut", drag: drag)
      }
      self?.settleDragging(accepted: false)
    }
  }

  private func settleDragging(accepted: Bool) {
    guard let activeDrag else { return }
    activeDrag.watchdog?.cancel()
    autoscrollController.stop()
    layoutAnimator.finish()
    let targetFrame = accepted ? settlementFrame() : activeDrag.sourceFrame
    animatePreview(to: targetFrame) { [weak self] in
      self?.finishDragging()
    }
  }

  private func finishDragging() {
    activeDrag?.watchdog?.cancel()
    previewPanel?.orderOut(nil)
    previewPanel = nil
    collectionLayout.draggedEntryIDs = []
    collectionLayout.dropTarget = nil
    activeDrag = nil
    hapticTracker.reset()
    collectionView.finishDragGesture()
    invalidateLayout()
    consumePendingUpdate()
  }

  private func setDropTarget(_ target: TerminalSidebarDropTarget?, pointerY: CGFloat?) {
    let changed = collectionLayout.dropTarget != target
    if changed {
      if let drag = activeDrag?.value {
        logDrag(
          "sidebar.drag.targetChanged",
          drag: drag,
          fields: ["pointerY=\(pointerY.map { coordinate($0) } ?? "nil")"]
            + (target.map { destinationFields($0.destination) } ?? ["destination=none"])
        )
      }
      layoutAnimator.animate(enabled: animationsEnabled) {
        collectionLayout.dropTarget = target
      }
    }
    if hapticTracker.shouldPerform(for: target?.destination) {
      NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
    }
    if let pointerY {
      autoscrollController.update(pointerY: pointerY)
    } else {
      autoscrollController.stop()
    }
    if changed { invalidateLayout() }
  }

  private func updateDropTarget(pointerY: CGFloat) {
    guard let drag = activeDrag?.value else { return }
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.items.map { ($0.id, $0.frame) }
    )
    let groupFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.groups.map { ($0.id, $0.frame) }
    )
    let target = TerminalSidebarDropTargetResolver.resolve(
      drag: drag,
      pointerY: pointerY,
      outline: appliedOutline,
      frames: itemFrames,
      groupFrames: groupFrames
    )
    setDropTarget(target, pointerY: target == nil ? nil : pointerY)
  }

  private func recoverDrop(at screenPoint: NSPoint) -> Bool {
    guard let drag = activeDrag?.value else { return false }
    guard let window = collectionView.window else {
      logDrag("sidebar.drag.recoveryRejected", drag: drag, fields: ["reason=noWindow"])
      return false
    }
    let windowPoint = window.convertPoint(fromScreen: screenPoint)
    let scrollLocation = scrollView.convert(windowPoint, from: nil)
    guard scrollView.bounds.contains(scrollLocation) else {
      logDrag(
        "sidebar.drag.recoveryRejected",
        drag: drag,
        fields: [
          "reason=outsideSidebar",
          "scrollX=\(coordinate(scrollLocation.x))",
          "scrollY=\(coordinate(scrollLocation.y))",
        ]
      )
      return false
    }
    let location = collectionView.convert(windowPoint, from: nil)
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.items.map { ($0.id, $0.frame) }
    )
    let groupFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.groups.map { ($0.id, $0.frame) }
    )
    guard
      let target = TerminalSidebarDropTargetResolver.resolve(
        drag: drag,
        pointerY: location.y,
        outline: appliedOutline,
        frames: itemFrames,
        groupFrames: groupFrames
      )
    else {
      logDrag(
        "sidebar.drag.recoveryRejected",
        drag: drag,
        fields: ["reason=noTarget", "pointerY=\(coordinate(location.y))"]
      )
      return false
    }
    setDropTarget(target, pointerY: location.y)
    return applyDrop(drag, target: target, source: "releaseRecovery")
  }

  private func applyDrop(
    _ drag: TerminalSidebarDragValue,
    target: TerminalSidebarDropTarget,
    source: String
  ) -> Bool {
    guard var activeDrag else {
      logDrag(
        "sidebar.drag.dropRejected",
        drag: drag,
        fields: ["source=\(source)", "reason=noActiveDrag"] + destinationFields(target.destination)
      )
      return false
    }
    guard let result = onDrop?(drag, target.destination) else {
      logDrag(
        "sidebar.drag.dropRejected",
        drag: drag,
        fields: ["source=\(source)", "reason=noHandler"] + destinationFields(target.destination)
      )
      return false
    }
    guard result.accepted else {
      logDrag(
        "sidebar.drag.dropRejected",
        drag: drag,
        fields: ["source=\(source)", "reason=modelRejected"] + destinationFields(target.destination)
      )
      return false
    }
    activeDrag.acceptedDrop = AcceptedDrop(
      drag: drag,
      destination: target.destination,
      createdGroupID: result.createdGroupID
    )
    self.activeDrag = activeDrag
    logDrag(
      "sidebar.drag.dropAccepted",
      drag: drag,
      fields: ["source=\(source)"] + destinationFields(target.destination)
    )
    return true
  }

  func collectionView(
    _ collectionView: NSCollectionView,
    validateDrop draggingInfo: NSDraggingInfo,
    proposedIndexPath proposedDropIndexPath: AutoreleasingUnsafeMutablePointer<NSIndexPath>,
    dropOperation proposedDropOperation: UnsafeMutablePointer<NSCollectionView.DropOperation>
  ) -> NSDragOperation {
    guard let drag = draggedValue(from: draggingInfo) else {
      setDropTarget(nil, pointerY: nil)
      return []
    }
    let location = collectionView.convert(draggingInfo.draggingLocation, from: nil)
    let itemFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.items.map { ($0.id, $0.frame) }
    )
    let groupFrames = Dictionary(
      uniqueKeysWithValues: collectionLayout.hitTestPlan.groups.map { ($0.id, $0.frame) }
    )
    guard
      let target = TerminalSidebarDropTargetResolver.resolve(
        drag: drag,
        pointerY: location.y,
        outline: appliedOutline,
        frames: itemFrames,
        groupFrames: groupFrames
      )
    else {
      setDropTarget(nil, pointerY: nil)
      return []
    }
    setDropTarget(target, pointerY: location.y)
    proposedDropIndexPath.pointee =
      IndexPath(
        item: min(
          target.insertionEntryIndex ?? 0,
          max(0, appliedOutline.visibleEntries.count - 1)
        ),
        section: 0
      ) as NSIndexPath
    proposedDropOperation.pointee = .on
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
    guard let drag = draggedValue(from: draggingInfo) else {
      if let drag = activeDrag?.value {
        logDrag("sidebar.drag.nativeDropRejected", drag: drag, fields: ["reason=invalidPayload"])
      }
      setDropTarget(nil, pointerY: nil)
      return false
    }
    guard let target = collectionLayout.dropTarget else {
      logDrag(
        "sidebar.drag.nativeDropRejected",
        drag: drag,
        fields: ["reason=noTarget", "pointerY=\(coordinate(location.y))"]
      )
      setDropTarget(nil, pointerY: nil)
      return false
    }
    let accepted = applyDrop(drag, target: target, source: "appKit")
    if !accepted {
      setDropTarget(nil, pointerY: nil)
    }
    return accepted
  }

  private func logDrag(
    _ event: String,
    drag: TerminalSidebarDragValue,
    fields: [String] = []
  ) {
    SupatermLog.verbose(
      SupatermLog.sidebarDrag,
      event,
      fields: dragFields(drag) + fields
    )
  }

  private func dragFields(_ drag: TerminalSidebarDragValue) -> [String] {
    switch drag {
    case .tab(let id):
      ["drag=tab", "dragID=\(SupatermLog.uuid(id.rawValue))"]
    case .group(let id):
      ["drag=group", "dragID=\(SupatermLog.uuid(id.rawValue))"]
    }
  }

  private func destinationFields(_ destination: TerminalSidebarDropDestination) -> [String] {
    switch destination {
    case .root(let isPinned, let index):
      ["destination=root", "isPinned=\(isPinned)", "index=\(index)"]
    case .group(let id, let index):
      [
        "destination=group",
        "destinationID=\(SupatermLog.uuid(id.rawValue))",
        "index=\(index)",
      ]
    case .createGroup(let targetTabID):
      [
        "destination=createGroup",
        "targetTabID=\(SupatermLog.uuid(targetTabID.rawValue))",
      ]
    }
  }

  private func coordinate(_ value: CGFloat) -> String {
    String(format: "%.1f", Double(value))
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

  private func draggedValue(from draggingInfo: NSDraggingInfo) -> TerminalSidebarDragValue? {
    guard
      let string = draggingInfo.draggingPasteboard.string(forType: .terminalSidebarOutlineItem),
      let value = TerminalSidebarDragValue(pasteboardValue: string),
      value == activeDrag?.value
    else { return nil }
    return value
  }

  private func preferredHeight(for id: TerminalSidebarEntryID, width: CGFloat) -> CGFloat {
    if case .pinDivider = id { return TerminalSidebarLayoutPlan.dividerHeight }
    guard let presentation = rows[id], let context else { return TerminalSidebarLayout.tabRowMinHeight }
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
    collectionView.frame.size = CGSize(width: documentWidth, height: max(viewportHeight, collectionView.frame.height))
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
    if let frame = collectionLayout.plan.dropIndicatorFrame {
      dropIndicatorView.frame = frame
      dropIndicatorView.isHidden = false
    } else {
      dropIndicatorView.isHidden = true
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

  private func outlineContainsActiveDrag(_ outline: TerminalSidebarOutline) -> Bool {
    guard let value = activeDrag?.value else { return true }
    switch value {
    case .tab(let id): return outline.root(containing: id) != nil
    case .group(let id): return outline.group(id) != nil
    }
  }

  private func groupColor(for value: TerminalSidebarDragValue) -> TerminalTabGroupColor? {
    guard case .group(let id) = value, let root = appliedOutline.group(id),
      case .group(_, let color, _) = root.content
    else { return nil }
    return color
  }

  private func windowScreenPoint(for event: NSEvent) -> NSPoint {
    guard let window = event.window else { return NSEvent.mouseLocation }
    return window.convertPoint(toScreen: event.locationInWindow)
  }

  private func updatePreviewPosition(screenPoint: NSPoint) {
    guard let activeDrag, let previewPanel else { return }
    previewPanel.setFrameOrigin(
      NSPoint(
        x: screenPoint.x - activeDrag.hotspot.x,
        y: screenPoint.y - previewPanel.frame.height + activeDrag.hotspot.y
      )
    )
  }

  private func settlementFrame() -> CGRect {
    if let indicator = collectionLayout.plan.dropIndicatorFrame {
      return CGRect(
        x: indicator.minX,
        y: indicator.midY - (activeDrag?.sourceFrame.height ?? 0) / 2,
        width: activeDrag?.sourceFrame.width ?? indicator.width,
        height: activeDrag?.sourceFrame.height ?? indicator.height
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
    return activeDrag?.sourceFrame ?? .zero
  }

  private func animatePreview(
    to collectionFrame: CGRect,
    completion: @escaping @MainActor @Sendable () -> Void
  ) {
    guard let previewPanel, let window = collectionView.window else {
      completion()
      return
    }
    let windowRect = collectionView.convert(collectionFrame, to: nil)
    let screenRect = window.convertToScreen(windowRect)
    let target = CGRect(
      x: screenRect.minX,
      y: screenRect.maxY - previewPanel.frame.height,
      width: previewPanel.frame.width,
      height: previewPanel.frame.height
    )
    guard animationsEnabled else {
      previewPanel.setFrame(target, display: true)
      completion()
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.12
      context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 0.46, 0.45, 0.94)
      previewPanel.animator().setFrame(target, display: true)
      previewPanel.animator().alphaValue = 0
    } completionHandler: {
      Task { @MainActor in completion() }
    }
  }

  private func accessibilityIdentifier(for presentation: TerminalSidebarRowPresentation) -> String {
    switch presentation {
    case .tab(let row):
      let tabID = row.tab.id.rawValue.uuidString.lowercased()
      guard let groupID = row.groupID else { return "sidebar.tab-row.\(tabID)" }
      return "sidebar.group.\(groupID.rawValue.uuidString.lowercased()).tab.\(tabID)"
    case .group(let row):
      return "sidebar.group-header.\(row.id.rawValue.uuidString.lowercased())"
    case .emptyGroup(let id):
      return "sidebar.empty-group.\(id.rawValue.uuidString.lowercased())"
    case .pinDivider: return "sidebar.pin-divider"
    case .newTab: return "sidebar.new-tab"
    case .newGroup: return "sidebar.new-group"
    }
  }

  @objc private func liveScrollDidStart() {
    autoscrollController.setLiveScrolling(true)
  }

  @objc private func liveScrollDidEnd() {
    autoscrollController.setLiveScrolling(false)
  }
}

extension NSPasteboard.PasteboardType {
  static let terminalSidebarOutlineItem = NSPasteboard.PasteboardType(
    "app.supaterm.sidebar-outline-item"
  )
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

private struct TerminalSidebarDragPreviewContent: View {
  let presentations: [TerminalSidebarRowPresentation]
  let context: TerminalSidebarRowContext
  let groupColor: TerminalTabGroupColor?

  var body: some View {
    VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
      ForEach(Array(presentations.enumerated()), id: \.offset) { _, presentation in
        TerminalSidebarHostedRow(presentation: presentation, context: context)
      }
    }
    .padding(2)
    .background(
      (groupColor?.sidebarColor(palette: context.palette) ?? Color.clear)
        .opacity(groupColor == nil ? 0 : 0.12)
    )
    .clipShape(.rect(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius))
    .shadow(color: context.palette.overlayShadow, radius: 8, y: 2)
  }
}

@MainActor
private final class TerminalSidebarDragPreviewPanel: NSPanel {
  init(
    presentations: [TerminalSidebarRowPresentation],
    context: TerminalSidebarRowContext,
    groupColor: TerminalTabGroupColor?,
    size: CGSize
  ) {
    super.init(
      contentRect: CGRect(origin: .zero, size: size),
      styleMask: [.borderless],
      backing: .buffered,
      defer: true
    )
    isOpaque = false
    backgroundColor = .clear
    level = .floating
    ignoresMouseEvents = true
    hasShadow = false
    isReleasedWhenClosed = false
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    alphaValue = 0.96
    contentView = NSHostingView(
      rootView: TerminalSidebarDragPreviewContent(
        presentations: presentations,
        context: context,
        groupColor: groupColor
      )
      .frame(width: size.width, height: size.height, alignment: .topLeading)
    )
  }
}
