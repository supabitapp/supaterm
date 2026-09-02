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
  static let expansionRevealOffset: CGFloat = 34 / 3

  private struct StructuralUpdate {
    let sourceIdentifiers: [TerminalSidebarEntryID]
    let sourceItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item]
    let targetOutline: TerminalSidebarOutline
    let expansionRevealEntryIDs: Set<TerminalSidebarEntryID>
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
  private(set) var dropTargetMap = TerminalSidebarDropTargetMap(targets: [])
  private var transitionOrigin: TerminalSidebarLayoutPlan?
  private var transitionProgress: CGFloat = 1
  private var attributesByIndexPath: [IndexPath: NSCollectionViewLayoutAttributes] = [:]
  private var structuralUpdate: StructuralUpdate?
  private var expansionRevealEntryIDs: Set<TerminalSidebarEntryID> = []
  private var preparedBoundsSize: CGSize = .zero
  private var contentHeightState = TerminalSidebarContentHeightState()

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
    transitionOrigin = plan
    transitionProgress = 0
  }

  func updateTransition(progress: CGFloat) {
    transitionProgress = progress
  }

  func finishTransition() {
    transitionOrigin = nil
    transitionProgress = 1
    plan = targetPlan
  }

  override func prepare() {
    super.prepare()
    guard let collectionView else { return }
    preparedBoundsSize = collectionView.bounds.size
    rebuild(width: collectionView.bounds.width, viewportHeight: collectionView.visibleRect.height)
  }

  override func invalidateLayout() {
    super.invalidateLayout()
    attributesByIndexPath.removeAll(keepingCapacity: true)
    dropTargetMap = TerminalSidebarDropTargetMap(targets: [])
  }

  private func rebuild(width: CGFloat, viewportHeight: CGFloat) {
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
    targetPlan = TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: heights,
      visibilityByEntryID: visibilityByEntryID,
      dragDropState: dragDropState,
      width: width,
      viewportHeight: viewportHeight
    )
    if let transitionOrigin, transitionOrigin.contentSize.width == targetPlan.contentSize.width {
      plan = targetPlan.interpolated(from: transitionOrigin, progress: transitionProgress)
    } else {
      finishTransition()
      plan = targetPlan
    }
    dropTargetMap = TerminalSidebarDropTargetMap(targets: targetPlan.semanticTargets)
    let itemCount =
      collectionView.numberOfSections > 0
      ? collectionView.numberOfItems(inSection: 0)
      : 0
    let displayedIdentifiers = displayedIdentifiers(
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
    guard commitStagedOutline(), let collectionView else { return }
    expansionRevealEntryIDs = structuralUpdate?.expansionRevealEntryIDs ?? []
    rebuild(width: collectionView.bounds.width, viewportHeight: collectionView.visibleRect.height)
  }

  override func initialLayoutAttributesForAppearingItem(
    at itemIndexPath: IndexPath
  ) -> NSCollectionViewLayoutAttributes? {
    let entries = outline.visibleEntries
    guard entries.indices.contains(itemIndexPath.item) else {
      return super.initialLayoutAttributesForAppearingItem(at: itemIndexPath)
    }
    let entryID = entries[itemIndexPath.item].id
    guard expansionRevealEntryIDs.contains(entryID),
      let item = targetPlan.items.first(where: { $0.id == entryID })
    else {
      return super.initialLayoutAttributesForAppearingItem(at: itemIndexPath)
    }
    let attributes = NSCollectionViewLayoutAttributes(forItemWith: itemIndexPath)
    attributes.frame = item.frame.offsetBy(dx: 0, dy: -Self.expansionRevealOffset)
    attributes.alpha = 0
    return attributes
  }

  override func finalizeCollectionViewUpdates() {
    super.finalizeCollectionViewUpdates()
    expansionRevealEntryIDs = []
  }

  override func shouldInvalidateLayout(forBoundsChange newBounds: NSRect) -> Bool {
    newBounds.size != preparedBoundsSize
  }

  private func structuralUpdate(to targetOutline: TerminalSidebarOutline) -> StructuralUpdate {
    let sourceIdentifiers = outline.visibleEntries.map(\.id)
    let sourceIdentifierSet = Set(sourceIdentifiers)
    let expandedGroupIDs = targetOutline.expandedGroupIDs(from: outline)
    return StructuralUpdate(
      sourceIdentifiers: sourceIdentifiers,
      sourceItemsByID: Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) }),
      targetOutline: targetOutline,
      expansionRevealEntryIDs: Set(
        targetOutline.visibleEntries.compactMap { entry in
          guard let groupID = entry.parentGroupID,
            expandedGroupIDs.contains(groupID),
            !sourceIdentifierSet.contains(entry.id)
          else { return nil }
          return entry.id
        }
      )
    )
  }

  @discardableResult
  private func commitStagedOutline() -> Bool {
    guard let structuralUpdate, outline != structuralUpdate.targetOutline else { return false }
    outline = structuralUpdate.targetOutline
    return true
  }
}
