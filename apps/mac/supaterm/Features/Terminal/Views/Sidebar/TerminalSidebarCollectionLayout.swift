import AppKit

struct TerminalSidebarDropTargetMap: Equatable {
  let targets: [TerminalSidebarSemanticTarget]

  func semanticTarget(at pointerY: CGFloat) -> TerminalSidebarSemanticTarget? {
    targets.first { target in
      pointerY >= target.frame.minY && pointerY < target.frame.maxY
    }
  }
}

struct TerminalSidebarContentHeightState: Equatable {
  private var minimumHeight: CGFloat?
  private var pinnedHeight: CGFloat?

  mutating func begin(at contentHeight: CGFloat) {
    minimumHeight = resolve(actualHeight: contentHeight)
  }

  mutating func finish() {
    guard let minimumHeight else { return }
    pinnedHeight = max(pinnedHeight ?? 0, minimumHeight)
    self.minimumHeight = nil
  }

  mutating func clearPin(actualHeight: CGFloat, visibleRect: CGRect) -> Bool {
    guard pinnedHeight != nil else { return false }
    let maximumOriginY = max(0, actualHeight - visibleRect.height)
    guard visibleRect.minY <= maximumOriginY else { return false }
    self.pinnedHeight = nil
    return true
  }

  func resolve(actualHeight: CGFloat) -> CGFloat {
    max(actualHeight, minimumHeight ?? 0, pinnedHeight ?? 0)
  }
}

final class TerminalSidebarCollectionLayout: NSCollectionViewLayout {
  static let parkedItemZIndex = 30

  private struct StructuralUpdate {
    let sourceIdentifiers: [TerminalSidebarEntryID]
    let sourceItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item]
    let targetOutline: TerminalSidebarOutline
  }

  private(set) var outline = TerminalSidebarOutline(
    roots: [],
    collapsedGroupIDs: [],
    topologyRevision: 0
  )
  var visibilityByEntryID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility] = [:]
  var dragDropState: TerminalSidebarDragDropState?
  var isNewTabItemHidden = false
  var preferredHeight: ((TerminalSidebarEntryID, CGFloat) -> CGFloat)?
  var itemIdentifiers: (() -> [TerminalSidebarEntryID])?

  private(set) var plan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedGroupIDs: [], topologyRevision: 0),
    preferredHeights: [:],
    dragDropState: nil,
    width: 0,
    viewportHeight: 0
  )
  private(set) var targetPlan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedGroupIDs: [], topologyRevision: 0),
    preferredHeights: [:],
    dragDropState: nil,
    width: 0,
    viewportHeight: 0
  )
  private var inlinePlan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedGroupIDs: [], topologyRevision: 0),
    preferredHeights: [:],
    dragDropState: nil,
    width: 0,
    viewportHeight: 0
  )
  private var inlineTargetPlan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedGroupIDs: [], topologyRevision: 0),
    preferredHeights: [:],
    dragDropState: nil,
    width: 0,
    viewportHeight: 0
  )
  private(set) var dropTargetMap = TerminalSidebarDropTargetMap(targets: [])
  private var transitionOrigin: TerminalSidebarLayoutPlan?
  private var transitionProgress: CGFloat = 1
  private var attributesByIndexPath: [IndexPath: NSCollectionViewLayoutAttributes] = [:]
  private var structuralUpdate: StructuralUpdate?
  private var insertedIndexPaths: Set<IndexPath> = []
  private var preparedBoundsSize: CGSize = .zero
  private var preparedWidth: CGFloat = 0
  private var preparedViewportHeight: CGFloat = 0
  private var contentHeightState = TerminalSidebarContentHeightState()
  private var parkingOnlyInvalidation = false

  func setOutline(_ outline: TerminalSidebarOutline) {
    let currentIdentifiers = self.outline.visibleEntries.map(\.id)
    if currentIdentifiers != outline.visibleEntries.map(\.id) {
      structuralUpdate = structuralUpdate(to: outline)
    }
    self.outline = outline
  }

  func stageOutline(_ outline: TerminalSidebarOutline) {
    structuralUpdate = structuralUpdate(to: outline)
  }

  func finishStructuralUpdate() {
    commitStagedOutline()
    structuralUpdate = nil
  }

  func beginCollapse() {
    contentHeightState.begin(at: collectionViewContentSize.height)
  }

  func endCollapse() {
    visibilityByEntryID = [:]
    contentHeightState.finish()
  }

  func clearPinnedContentHeight(visibleRect: CGRect) -> Bool {
    contentHeightState.clearPin(
      actualHeight: plan.contentSize.height,
      visibleRect: visibleRect
    )
  }

  func beginTransition() {
    transitionOrigin = inlinePlan
    transitionProgress = 0
  }

  func updateTransition(progress: CGFloat) {
    transitionProgress = progress
  }

  func finishTransition() {
    transitionOrigin = nil
    transitionProgress = 1
    inlinePlan = inlineTargetPlan
    plan = targetPlan
  }

  @discardableResult
  func invalidatePinnedParkingIfNeeded(visibleRect: CGRect) -> Bool {
    let parkingFrame = inlinePlan.pinnedTabsPlacement(
      in: outline,
      visibleRect: visibleRect
    )?.backgroundFrame
    guard parkingFrame != plan.pinnedParkingFrame else { return false }
    parkingOnlyInvalidation = true
    super.invalidateLayout()
    return true
  }

  override func prepare() {
    super.prepare()
    guard let collectionView else { return }
    let width = collectionView.bounds.width
    let viewportHeight = collectionView.visibleRect.height
    let updatesOnlyParking = parkingOnlyInvalidation
      && preparedWidth == width
      && preparedViewportHeight == viewportHeight
    preparedBoundsSize = collectionView.bounds.size
    preparedWidth = width
    preparedViewportHeight = viewportHeight
    if updatesOnlyParking {
      updateParking(visibleRect: collectionView.visibleRect)
      rebuildAttributes(entries: outline.visibleEntries)
      return
    }
    parkingOnlyInvalidation = false
    rebuild(width: width, viewportHeight: viewportHeight)
  }

  func invalidateGeometry() {
    parkingOnlyInvalidation = false
    invalidateLayout()
  }

  override func invalidateLayout() {
    super.invalidateLayout()
    // AppKit invalidates again when scrolling changes the clip bounds. Preserve the
    // parking-only path until an explicit geometry change or viewport resize clears it.
    guard !parkingOnlyInvalidation else { return }
    attributesByIndexPath.removeAll(keepingCapacity: true)
    dropTargetMap = TerminalSidebarDropTargetMap(targets: [])
  }

  private func rebuild(
    width: CGFloat,
    viewportHeight: CGFloat,
    identifiersOverride: [TerminalSidebarEntryID]? = nil
  ) {
    guard let collectionView else { return }
    let entries = outline.visibleEntries
    let heights = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        let itemWidth =
          switch entry.kind {
          case .pinDivider, .newTab: width
          case .tab, .group: TerminalSidebarLayout.cardHorizontalInsets.width(in: width)
          }
        return (
          entry.id,
          preferredHeight?(entry.id, itemWidth) ?? TerminalSidebarLayout.tabRowMinHeight
        )
      }
    )
    inlineTargetPlan = TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: heights,
      visibilityByEntryID: visibilityByEntryID,
      dragDropState: dragDropState,
      width: width,
      viewportHeight: viewportHeight
    )
    if let transitionOrigin,
      transitionOrigin.contentSize.width == inlineTargetPlan.contentSize.width
    {
      inlinePlan = inlineTargetPlan.interpolated(
        from: transitionOrigin,
        progress: transitionProgress
      )
    } else {
      transitionOrigin = nil
      transitionProgress = 1
      inlinePlan = inlineTargetPlan
    }
    updateParking(visibleRect: collectionView.visibleRect)
    rebuildAttributes(entries: entries, identifiersOverride: identifiersOverride)
  }

  private func updateParking(visibleRect: CGRect) {
    targetPlan = inlineTargetPlan.parkingPinnedTabs(in: outline, visibleRect: visibleRect)
    plan = inlinePlan.parkingPinnedTabs(in: outline, visibleRect: visibleRect)
    dropTargetMap = TerminalSidebarDropTargetMap(targets: targetPlan.semanticTargets)
  }

  private func rebuildAttributes(
    entries: [TerminalSidebarEntry],
    identifiersOverride: [TerminalSidebarEntryID]? = nil
  ) {
    guard let collectionView else { return }
    let collectionItemCount = collectionView.numberOfSections > 0
      ? collectionView.numberOfItems(inSection: 0)
      : 0
    let itemCount = identifiersOverride?.count ?? collectionItemCount
    let displayedIdentifiers = identifiersOverride
      ?? displayedIdentifiers(
        snapshotIdentifiers: itemIdentifiers?() ?? entries.map(\.id),
        itemCount: itemCount
      )
    attributesByIndexPath = Dictionary(
      uniqueKeysWithValues: displayedItems(
        identifiers: displayedIdentifiers,
        itemCount: itemCount
      ).map { indexPath, item in
        let attributes = NSCollectionViewLayoutAttributes(forItemWith: indexPath)
        attributes.frame = item.frame
        attributes.alpha = item.alpha
        attributes.isHidden = isNewTabItemHidden && item.id == .newTab
        attributes.zIndex = plan.parkedPinnedEntryIDs.contains(item.id)
          ? Self.parkedItemZIndex
          : 0
        return (indexPath, attributes)
      }
    )
  }

  func displayedItems(
    identifiers: [TerminalSidebarEntryID],
    itemCount: Int
  ) -> [(IndexPath, TerminalSidebarLayoutPlan.Item)] {
    let targetItems = Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) })
    return identifiers.prefix(itemCount).enumerated().compactMap { index, id in
      guard let item = targetItems[id] ?? structuralUpdate?.sourceItemsByID[id] else { return nil }
      return (IndexPath(item: index, section: 0), item)
    }
  }

  func displayedIdentifiers(
    snapshotIdentifiers: [TerminalSidebarEntryID],
    itemCount: Int
  ) -> [TerminalSidebarEntryID] {
    let targetIdentifiers = outline.visibleEntries.map(\.id)
    guard
      let sourceIdentifiers = structuralUpdate?.sourceIdentifiers,
      sourceIdentifiers.count != targetIdentifiers.count
    else {
      return snapshotIdentifiers
    }
    if itemCount == sourceIdentifiers.count { return sourceIdentifiers }
    if itemCount == targetIdentifiers.count { return targetIdentifiers }
    return snapshotIdentifiers
  }

  override var collectionViewContentSize: NSSize {
    CGSize(
      width: plan.contentSize.width,
      height: contentHeightState.resolve(actualHeight: plan.contentSize.height)
    )
  }

  override func layoutAttributesForElements(in rect: NSRect) -> [NSCollectionViewLayoutAttributes] {
    attributesByIndexPath.values.filter { $0.frame.height > 0 && $0.frame.intersects(rect) }
  }

  override func layoutAttributesForItem(
    at indexPath: IndexPath
  ) -> NSCollectionViewLayoutAttributes? {
    attributesByIndexPath[indexPath]
  }

  override func prepare(forCollectionViewUpdates updateItems: [NSCollectionViewUpdateItem]) {
    super.prepare(forCollectionViewUpdates: updateItems)
    parkingOnlyInvalidation = false
    guard commitStagedOutline(), let collectionView else {
      insertedIndexPaths = []
      return
    }
    insertedIndexPaths = Set(
      updateItems.compactMap { update in
        update.updateAction == .insert ? update.indexPathAfterUpdate : nil
      }
    )
    // AppKit can still report the source item count here, so rebuild from target identities.
    rebuild(
      width: collectionView.bounds.width,
      viewportHeight: collectionView.visibleRect.height,
      identifiersOverride: outline.visibleEntries.map(\.id)
    )
  }

  override func initialLayoutAttributesForAppearingItem(
    at itemIndexPath: IndexPath
  ) -> NSCollectionViewLayoutAttributes? {
    guard
      insertedIndexPaths.contains(itemIndexPath),
      let attributes = layoutAttributesForItem(at: itemIndexPath)?.copy()
        as? NSCollectionViewLayoutAttributes
    else {
      return super.initialLayoutAttributesForAppearingItem(at: itemIndexPath)
    }
    attributes.frame = attributes.frame.offsetBy(
      dx: 0,
      dy: TerminalSidebarLayoutMotion.insertedItemOffset
    )
    attributes.alpha = 0
    return attributes
  }

  override func finalizeCollectionViewUpdates() {
    super.finalizeCollectionViewUpdates()
    insertedIndexPaths = []
  }

  override func shouldInvalidateLayout(forBoundsChange newBounds: NSRect) -> Bool {
    newBounds.size != preparedBoundsSize
  }

  private func structuralUpdate(to targetOutline: TerminalSidebarOutline) -> StructuralUpdate {
    StructuralUpdate(
      sourceIdentifiers: outline.visibleEntries.map(\.id),
      sourceItemsByID: Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) }),
      targetOutline: targetOutline
    )
  }

  @discardableResult
  private func commitStagedOutline() -> Bool {
    guard let structuralUpdate, outline != structuralUpdate.targetOutline else { return false }
    outline = structuralUpdate.targetOutline
    return true
  }
}
