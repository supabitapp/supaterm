import AppKit

struct TerminalSidebarDropTargetMap: Equatable {
  let targets: [TerminalSidebarSemanticTarget]

  func semanticTarget(at pointerY: CGFloat) -> TerminalSidebarSemanticTarget? {
    targets.first { target in
      pointerY >= target.frame.minY && pointerY < target.frame.maxY
    }
  }
}

struct TerminalSidebarLayoutPlan: Equatable {
  struct Visibility: Equatable {
    let height: CGFloat
    let alpha: CGFloat

    static let visible = Self(height: 1, alpha: 1)
  }

  struct Item: Equatable {
    let id: TerminalSidebarEntryID
    let frame: CGRect
    let alpha: CGFloat
  }

  struct Group: Equatable {
    let id: TerminalTabGroupID
    let color: TerminalTabGroupColor
    let frame: CGRect
    let alpha: CGFloat
  }

  static let horizontalInset: CGFloat = 4
  static let childIndentation: CGFloat = 12
  static let childTrailingInset: CGFloat = 6
  static let rootSpacing: CGFloat = 10
  static let pinDividerTopSpacing: CGFloat = 8
  private static let groupSurfaceVerticalOverflow: CGFloat = 2
  static let expandedGroupTrailingSpacing: CGFloat = 3
  static let dividerHeight: CGFloat = 9
  static let rootBoundaryTargetHeight: CGFloat = 7
  static let initialY: CGFloat = -3
  static let bottomPadding: CGFloat = 120

  let items: [Item]
  let groups: [Group]
  let contentSize: CGSize
  let dropPlaceholderFrame: CGRect?
  let highlightedGroupID: TerminalTabGroupID?
  let semanticTargets: [TerminalSidebarSemanticTarget]

  private init(
    items: [Item],
    groups: [Group],
    contentSize: CGSize,
    dropPlaceholderFrame: CGRect?,
    highlightedGroupID: TerminalTabGroupID?,
    semanticTargets: [TerminalSidebarSemanticTarget]
  ) {
    self.items = items
    self.groups = groups
    self.contentSize = contentSize
    self.dropPlaceholderFrame = dropPlaceholderFrame
    self.highlightedGroupID = highlightedGroupID
    self.semanticTargets = semanticTargets
  }

  init(
    outline: TerminalSidebarOutline,
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    visibilityByEntryID: [TerminalSidebarEntryID: Visibility] = [:],
    dragDropState: TerminalSidebarDragDropState?,
    width: CGFloat,
    viewportHeight: CGFloat
  ) {
    let entries = outline.visibleEntries
    let draggedIDs = Set(dragDropState?.draggingItemIDs ?? [])
    let insertionIndex = Self.insertionIndex(
      for: dragDropState?.target?.placeholder,
      entries: entries
    )
    let dropGapHeight = Self.dropGapHeight(
      entries: entries,
      preferredHeights: preferredHeights,
      draggedItemIDs: dragDropState?.draggingItemIDs ?? [],
      insertionIndex: insertionIndex
    )
    let availableWidth = max(1, width - Self.horizontalInset * 2)
    var items: [Item] = []
    var y = Self.initialY
    var dropPlaceholderFrame: CGRect?

    for (index, entry) in entries.enumerated() {
      if insertionIndex == index, dropGapHeight > 0 {
        dropPlaceholderFrame = Self.placeholderFrame(
          y: y,
          height: dropGapHeight,
          width: availableWidth,
          destination: dragDropState?.target?.destination
        )
        y += dropGapHeight
      }

      let isDragged = draggedIDs.contains(entry.id)
      let visibility = visibilityByEntryID[entry.id] ?? .visible
      if y > Self.initialY, !isDragged {
        y += Self.spacing(before: entry, previous: entries[safe: index - 1]) * visibility.height
      }
      let insets = Self.horizontalInsets(for: entry)
      let preferredHeight = preferredHeights[entry.id] ?? Self.defaultHeight(for: entry)
      let height = isDragged ? 0 : preferredHeight * visibility.height
      items.append(
        Item(
          id: entry.id,
          frame: CGRect(
            x: Self.horizontalInset + insets.leading,
            y: y,
            width: max(1, availableWidth - insets.leading - insets.trailing),
            height: height
          ),
          alpha: isDragged ? 0 : visibility.alpha
        )
      )
      y += height
    }

    if insertionIndex == entries.count, dropGapHeight > 0 {
      dropPlaceholderFrame = Self.placeholderFrame(
        y: y,
        height: dropGapHeight,
        width: availableWidth,
        destination: dragDropState?.target?.destination
      )
      y += dropGapHeight
    }

    let itemByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    let groups = Self.groups(entries: entries, itemByID: itemByID)
    let targetGeometry = Self.targetGeometry(
      TargetGeometryContext(
        outline: outline,
        itemByID: itemByID,
        draggedIDs: draggedIDs,
        sourceIsTab: {
          guard let sourceID = dragDropState?.draggingItemIDs.first else { return false }
          if case .tab = sourceID { return true }
          return false
        }(),
        width: width,
        viewportHeight: viewportHeight
      )
    )
    self.items = items
    self.groups = groups
    contentSize = CGSize(
      width: width,
      height: max(0, y + Self.rootSpacing + Self.bottomPadding)
    )
    self.dropPlaceholderFrame = dropPlaceholderFrame
    highlightedGroupID = dragDropState?.target?.highlightedGroupID
    semanticTargets = targetGeometry
  }

  func semanticTarget(at pointerY: CGFloat) -> TerminalSidebarSemanticTarget? {
    semanticTargets.first { target in
      pointerY >= target.frame.minY && pointerY < target.frame.maxY
    }
  }

  func groupID(at point: CGPoint) -> TerminalTabGroupID? {
    groups.first { $0.frame.contains(point) }?.id
  }

  func interpolated(from origin: Self, progress: CGFloat) -> Self {
    let progress = max(0, min(progress, 1))
    let originItems = Dictionary(uniqueKeysWithValues: origin.items.map { ($0.id, $0) })
    let originGroups = Dictionary(uniqueKeysWithValues: origin.groups.map { ($0.id, $0) })
    return Self(
      items: items.map { target in
        let source =
          originItems[target.id]
          ?? Item(id: target.id, frame: target.frame.offsetBy(dx: 0, dy: -6), alpha: 0)
        return Item(
          id: target.id,
          frame: Self.interpolate(source.frame, target.frame, progress: progress),
          alpha: source.alpha + (target.alpha - source.alpha) * progress
        )
      },
      groups: groups.map { target in
        let source =
          originGroups[target.id]
          ?? Group(
            id: target.id,
            color: target.color,
            frame: CGRect(
              x: target.frame.minX,
              y: target.frame.minY,
              width: target.frame.width,
              height: 0
            ),
            alpha: 0
          )
        return Group(
          id: target.id,
          color: target.color,
          frame: Self.interpolate(source.frame, target.frame, progress: progress),
          alpha: source.alpha + (target.alpha - source.alpha) * progress
        )
      },
      contentSize: CGSize(
        width: Self.interpolateValue(
          origin.contentSize.width,
          contentSize.width,
          progress: progress
        ),
        height: Self.interpolateValue(
          origin.contentSize.height,
          contentSize.height,
          progress: progress
        )
      ),
      dropPlaceholderFrame: dropPlaceholderFrame,
      highlightedGroupID: highlightedGroupID,
      semanticTargets: semanticTargets
    )
  }

  private static func groups(
    entries: [TerminalSidebarEntry],
    itemByID: [TerminalSidebarEntryID: Item]
  ) -> [Group] {
    entries.compactMap { entry -> Group? in
      guard case .group(let id, let color, _, _) = entry.kind,
        let header = itemByID[entry.id],
        header.frame.height > 0
      else { return nil }
      let descendants = entries.drop { $0.id != entry.id }.dropFirst().prefix { descendant in
        switch descendant.kind {
        case .tab(_, let parentGroupID, _): parentGroupID == id
        case .group, .pinDivider, .newTab: false
        }
      }
      let descendantFrames = descendants.compactMap { itemByID[$0.id]?.frame }.filter {
        $0.height > 0
      }
      let frame = descendantFrames.reduce(header.frame) { $0.union($1) }
      return Group(
        id: id,
        color: color,
        frame: frame.insetBy(dx: 0, dy: -Self.groupSurfaceVerticalOverflow),
        alpha: header.alpha
      )
    }
  }

  private struct TargetGeometryContext {
    let outline: TerminalSidebarOutline
    let itemByID: [TerminalSidebarEntryID: Item]
    let draggedIDs: Set<TerminalSidebarEntryID>
    let sourceIsTab: Bool
    let width: CGFloat
    let viewportHeight: CGFloat
  }

  private struct RootTargetGeometry {
    let targets: [TerminalSidebarSemanticTarget]
    let tabsEndY: CGFloat
  }

  private static func targetGeometry(
    _ context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    var targets: [TerminalSidebarSemanticTarget] = []
    var tabsEndY = Self.initialY

    for (rootIndex, root) in context.outline.roots.enumerated() {
      if rootIndex > 0, context.outline.roots[rootIndex - 1].isPinned, !root.isPinned,
        let divider = context.itemByID[.pinDivider]
      {
        targets.append(
          TerminalSidebarSemanticTarget(
            path: .pinnedEnd,
            frame: CGRect(
              x: 0,
              y: divider.frame.minY,
              width: context.width,
              height: divider.frame.height
            )
          )
        )
      }
      let rootGeometry = Self.targetGeometry(
        rootIndex: rootIndex,
        root: root,
        context: context
      )
      targets.append(contentsOf: rootGeometry.targets)
      tabsEndY = max(tabsEndY, rootGeometry.tabsEndY)
    }

    targets.append(
      TerminalSidebarSemanticTarget(
        path: .trailingRoot,
        frame: CGRect(
          x: 0,
          y: tabsEndY,
          width: context.width,
          height: context.viewportHeight
        )
      )
    )
    return targets
  }

  private static func targetGeometry(
    rootIndex: Int,
    root: TerminalSidebarOutline.Root,
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    switch root.content {
    case .tab(let tabID):
      guard let item = context.itemByID[.tab(tabID)] else {
        return RootTargetGeometry(targets: [], tabsEndY: initialY)
      }
      guard !context.draggedIDs.contains(.tab(tabID)) else {
        return RootTargetGeometry(targets: [], tabsEndY: item.frame.maxY)
      }
      return RootTargetGeometry(
        targets: [
          TerminalSidebarSemanticTarget(
            path: .rootBoundary(index: rootIndex, affinity: .before),
            frame: CGRect(
              x: 0,
              y: item.frame.minY,
              width: context.width,
              height: item.frame.height
            )
          )
        ],
        tabsEndY: item.frame.maxY
      )
    case .group(let groupID, _, _, let tabIDs):
      return groupTargetGeometry(
        rootIndex: rootIndex,
        groupID: groupID,
        tabIDs: tabIDs,
        context: context
      )
    }
  }

  private static func groupTargetGeometry(
    rootIndex: Int,
    groupID: TerminalTabGroupID,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    guard let header = context.itemByID[.group(groupID)] else {
      return RootTargetGeometry(targets: [], tabsEndY: initialY)
    }
    let groupIsDragged = context.draggedIDs.contains(.group(groupID))
    if context.outline.collapsedGroupIDs.contains(groupID) || tabIDs.isEmpty {
      let topTargetHeight = ceil(header.frame.height / 2)
      var targets: [TerminalSidebarSemanticTarget] = []
      if !groupIsDragged {
        targets = [
          TerminalSidebarSemanticTarget(
            path: .rootBoundary(index: rootIndex, affinity: .before),
            frame: CGRect(
              x: 0,
              y: header.frame.minY,
              width: context.width,
              height: min(rootBoundaryTargetHeight, header.frame.height)
            )
          ),
          TerminalSidebarSemanticTarget(
            path: .group(groupID, index: tabIDs.count),
            frame: CGRect(
              x: 0,
              y: header.frame.minY,
              width: context.width + 26,
              height: topTargetHeight
            )
          ),
          TerminalSidebarSemanticTarget(
            path: .rootBoundary(index: rootIndex, affinity: .after),
            frame: CGRect(
              x: 0,
              y: header.frame.minY + topTargetHeight,
              width: context.width + 26,
              height: header.frame.height - topTargetHeight
            )
          ),
        ]
      }
      return RootTargetGeometry(
        targets: targets,
        tabsEndY: header.frame.maxY
      )
    }

    let childFrames = tabIDs.compactMap { context.itemByID[.tab($0)]?.frame }
    let childEndY = childFrames.map(\.maxY).max() ?? header.frame.maxY
    let containerMaxY = childEndY + expandedGroupTrailingSpacing
    guard !groupIsDragged else {
      return RootTargetGeometry(
        targets: [],
        tabsEndY: containerMaxY
      )
    }
    var targets = [
      TerminalSidebarSemanticTarget(
        path: .rootBoundary(index: rootIndex, affinity: .before),
        frame: CGRect(
          x: 0,
          y: header.frame.minY,
          width: context.width,
          height: min(rootBoundaryTargetHeight, header.frame.height)
        )
      ),
      TerminalSidebarSemanticTarget(
        path: .rootItem(index: rootIndex),
        frame: CGRect(
          x: 3,
          y: header.frame.minY,
          width: context.width,
          height: max(0, header.frame.height - expandedGroupTrailingSpacing)
        )
      ),
    ]
    targets.append(contentsOf: childTargets(groupID: groupID, tabIDs: tabIDs, context: context))
    let exitTargetHeight = expandedGroupExitTargetHeight(
      childEndY: childEndY,
      rootIndex: rootIndex,
      context: context
    )
    if context.sourceIsTab, exitTargetHeight > 0 {
      targets.append(
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(index: rootIndex, affinity: .after),
          frame: CGRect(
            x: 0,
            y: childEndY,
            width: context.width,
            height: exitTargetHeight
          )
        )
      )
    }
    return RootTargetGeometry(
      targets: targets,
      tabsEndY: containerMaxY
    )
  }

  private static func expandedGroupExitTargetHeight(
    childEndY: CGFloat,
    rootIndex: Int,
    context: TargetGeometryContext
  ) -> CGFloat {
    guard let root = context.outline.roots[safe: rootIndex] else { return 0 }
    let nextRoot = context.outline.roots.dropFirst(rootIndex + 1).first {
      !context.draggedIDs.contains($0.entryID)
    }
    if let nextRoot, root.isPinned != nextRoot.isPinned { return 0 }
    let nextEntryID = nextRoot?.entryID ?? .newTab
    guard let nextItem = context.itemByID[nextEntryID] else { return 0 }
    return max(0, nextItem.frame.minY - childEndY)
  }

  private static func childTargets(
    groupID: TerminalTabGroupID,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    tabIDs.enumerated().compactMap { childIndex, tabID in
      guard
        let item = context.itemByID[.tab(tabID)],
        !context.draggedIDs.contains(.tab(tabID))
      else { return nil }
      return TerminalSidebarSemanticTarget(
        path: .group(groupID, index: childIndex),
        frame: CGRect(
          x: 0,
          y: item.frame.minY,
          width: context.width,
          height: item.frame.height
        )
      )
    }
  }

  private static func insertionIndex(
    for placeholder: TerminalSidebarDropPlaceholder?,
    entries: [TerminalSidebarEntry]
  ) -> Int? {
    guard let placeholder else { return nil }
    switch placeholder {
    case .before(let id):
      return entries.firstIndex { $0.id == id }
    case .beforeFooter:
      return entries.firstIndex { $0.id == .newTab } ?? entries.count
    case .groupEnd(let groupID):
      guard let header = entries.firstIndex(where: { $0.id == .group(groupID) }) else {
        return entries.firstIndex { $0.id == .newTab } ?? entries.count
      }
      return entries[(header + 1)...].firstIndex { entry in
        switch entry.kind {
        case .group, .pinDivider, .newTab: true
        case .tab(_, let parentGroupID, _): parentGroupID != groupID
        }
      } ?? entries.count
    }
  }

  private static func dropGapHeight(
    entries: [TerminalSidebarEntry],
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    draggedItemIDs: [TerminalSidebarEntryID],
    insertionIndex: Int?
  ) -> CGFloat {
    guard insertionIndex != nil else { return 0 }
    let entriesByID = Dictionary(uniqueKeysWithValues: entries.map { ($0.id, $0) })
    let dragged = draggedItemIDs.compactMap { entriesByID[$0] }
    if dragged.allSatisfy({ entry in
      if case .tab = entry.kind { return true }
      return false
    }) {
      let heights = dragged.reduce(0) { total, entry in
        total + (preferredHeights[entry.id] ?? defaultHeight(for: entry))
      }
      return heights + TerminalSidebarLayout.tabRowSpacing * CGFloat(max(0, dragged.count - 1))
    }
    return dragged.enumerated().reduce(0) { total, element in
      let (index, entry) = element
      let previous = index > 0 ? dragged[index - 1] : nil
      let spacing = previous.map { Self.spacing(before: entry, previous: $0) } ?? 0
      return total + spacing + (preferredHeights[entry.id] ?? defaultHeight(for: entry))
    }
  }

  private static func placeholderFrame(
    y: CGFloat,
    height: CGFloat,
    width: CGFloat,
    destination: TerminalSidebarDropDestination?
  ) -> CGRect {
    let insets: (leading: CGFloat, trailing: CGFloat)
    switch destination {
    case .group:
      insets = (childIndentation, childTrailingInset)
    case .root, nil:
      insets = (0, 0)
    }
    return CGRect(
      x: horizontalInset + insets.leading,
      y: y,
      width: max(1, width - insets.leading - insets.trailing),
      height: height
    )
  }

  private static func horizontalInsets(
    for entry: TerminalSidebarEntry
  ) -> (leading: CGFloat, trailing: CGFloat) {
    switch entry.kind {
    case .tab(_, .some, _): (childIndentation, childTrailingInset)
    case .tab(_, nil, _), .group, .pinDivider, .newTab: (0, 0)
    }
  }

  private static func spacing(
    before entry: TerminalSidebarEntry,
    previous: TerminalSidebarEntry?
  ) -> CGFloat {
    switch (previous?.kind, entry.kind) {
    case (_, .pinDivider):
      pinDividerTopSpacing
    case (.pinDivider, .group):
      TerminalSidebarLayout.tabRowSpacing + groupSurfaceVerticalOverflow
    case (.pinDivider, _):
      TerminalSidebarLayout.tabRowSpacing
    case (.tab(_, .some, _), .tab(_, nil, _)),
      (.group, .tab(_, nil, _)):
      rootSpacing
    case (_, .group), (_, .newTab):
      rootSpacing
    default:
      TerminalSidebarLayout.tabRowSpacing
    }
  }

  private static func defaultHeight(for entry: TerminalSidebarEntry) -> CGFloat {
    if case .pinDivider = entry.kind { return dividerHeight }
    return TerminalSidebarLayout.tabRowMinHeight
  }

  private static func interpolateValue(
    _ source: CGFloat,
    _ target: CGFloat,
    progress: CGFloat
  ) -> CGFloat {
    source + (target - source) * progress
  }

  private static func interpolate(_ source: CGRect, _ target: CGRect, progress: CGFloat) -> CGRect {
    CGRect(
      x: interpolateValue(source.minX, target.minX, progress: progress),
      y: interpolateValue(source.minY, target.minY, progress: progress),
      width: interpolateValue(source.width, target.width, progress: progress),
      height: interpolateValue(source.height, target.height, progress: progress)
    )
  }
}

final class TerminalSidebarCollectionLayout: NSCollectionViewLayout {
  private(set) var outline = TerminalSidebarOutline(
    roots: [],
    collapsedGroupIDs: [],
    topologyRevision: 0
  )
  var visibilityByEntryID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility] = [:]
  var dragDropState: TerminalSidebarDragDropState?
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
  private var fallbackItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item] = [:]
  private var preparedBoundsSize: CGSize = .zero

  func setOutline(_ outline: TerminalSidebarOutline) {
    if self.outline.visibleEntries.map(\.id) != outline.visibleEntries.map(\.id) {
      fallbackItemsByID = Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) })
    }
    self.outline = outline
  }

  func finishStructuralUpdate() {
    fallbackItemsByID = [:]
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

  private func rebuild(width: CGFloat, viewportHeight: CGFloat) {
    guard let collectionView else { return }
    let itemWidth = max(1, width - TerminalSidebarLayoutPlan.horizontalInset * 2)
    let entries = outline.visibleEntries
    let heights = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        (entry.id, preferredHeight?(entry.id, itemWidth) ?? TerminalSidebarLayout.tabRowMinHeight)
      }
    )
    let hitTestState = dragDropState.map {
      TerminalSidebarDragDropState(draggingItemIDs: $0.draggingItemIDs, target: nil)
    }
    let hitTestPlan = TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: heights,
      visibilityByEntryID: visibilityByEntryID,
      dragDropState: hitTestState,
      width: width,
      viewportHeight: viewportHeight
    )
    dropTargetMap = TerminalSidebarDropTargetMap(targets: hitTestPlan.semanticTargets)
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
    let itemCount =
      collectionView.numberOfSections > 0
      ? collectionView.numberOfItems(inSection: 0)
      : 0
    let identifiers = itemIdentifiers?() ?? entries.map(\.id)
    let displayedIdentifiers = identifiers.count == itemCount ? identifiers : entries.map(\.id)
    attributesByIndexPath = Dictionary(
      uniqueKeysWithValues: displayedItems(
        identifiers: displayedIdentifiers,
        itemCount: itemCount
      ).map { indexPath, item in
        let attributes = NSCollectionViewLayoutAttributes(forItemWith: indexPath)
        attributes.frame = item.frame
        attributes.alpha = item.alpha
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
      guard let item = targetItems[id] ?? fallbackItemsByID[id] else { return nil }
      return (IndexPath(item: index, section: 0), item)
    }
  }

  override var collectionViewContentSize: NSSize { plan.contentSize }

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

extension Array {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
