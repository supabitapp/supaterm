import AppKit

struct TerminalSidebarDropTargetMap: Equatable {
  let targets: [TerminalSidebarSemanticTarget]

  init(targets: [TerminalSidebarSemanticTarget]) {
    self.targets = targets
  }

  init(plan: TerminalSidebarLayoutPlan, activePath: TerminalSidebarSemanticPath?) {
    guard
      let activePath,
      let placeholder = plan.dropPlaceholderFrame,
      let activeIndex = plan.semanticTargets.firstIndex(where: { $0.path == activePath })
    else {
      targets = plan.semanticTargets
      return
    }
    let active = plan.semanticTargets[activeIndex]
    let verticalDistance = max(
      active.frame.minY - placeholder.maxY,
      placeholder.minY - active.frame.maxY,
      0
    )
    guard verticalDistance <= TerminalSidebarLayoutPlan.rootSpacing else {
      targets = plan.semanticTargets
      return
    }
    var targets = plan.semanticTargets
    targets[activeIndex] = TerminalSidebarSemanticTarget(
      path: active.path,
      frame: active.frame.union(placeholder)
    )
    self.targets = targets
  }

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
  private struct StructuralUpdate {
    let sourceIdentifiers: [TerminalSidebarEntryID]
    let sourceItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item]
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
  private var preparedBoundsSize: CGSize = .zero
  private var contentHeightState = TerminalSidebarContentHeightState()

  func setOutline(_ outline: TerminalSidebarOutline) {
    let currentIdentifiers = self.outline.visibleEntries.map(\.id)
    if currentIdentifiers != outline.visibleEntries.map(\.id) {
      structuralUpdate = StructuralUpdate(
        sourceIdentifiers: currentIdentifiers,
        sourceItemsByID: Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) })
      )
    }
    self.outline = outline
  }

  func finishStructuralUpdate() {
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
    dropTargetMap = TerminalSidebarDropTargetMap(
      plan: plan,
      activePath: dragDropState?.target?.path
    )
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

  override func shouldInvalidateLayout(forBoundsChange newBounds: NSRect) -> Bool {
    newBounds.size != preparedBoundsSize
  }
}
