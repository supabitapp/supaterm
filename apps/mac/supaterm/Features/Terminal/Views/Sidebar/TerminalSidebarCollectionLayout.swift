import AppKit
import SupaTheme

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

  struct Project: Equatable {
    let id: TerminalProjectID
    let color: ThemeTint
    let frame: CGRect
    let alpha: CGFloat
  }

  static let rootSpacing: CGFloat = 10
  static let pinDividerTopSpacing: CGFloat = 8
  static let expandedProjectTrailingSpacing: CGFloat = 3
  static let dividerHeight: CGFloat = 9
  static let rootBoundaryTargetHeight: CGFloat = 7
  static let initialY: CGFloat =
    Self.rootSpacing + TerminalSidebarLayout.projectSurfaceOverflow
  static let bottomPadding: CGFloat = 120

  let items: [Item]
  let projects: [Project]
  let contentSize: CGSize
  let dropPlaceholderFrame: CGRect?
  let highlightedProjectID: TerminalProjectID?
  let semanticTargets: [TerminalSidebarSemanticTarget]

  private init(
    items: [Item],
    projects: [Project],
    contentSize: CGSize,
    dropPlaceholderFrame: CGRect?,
    highlightedProjectID: TerminalProjectID?,
    semanticTargets: [TerminalSidebarSemanticTarget]
  ) {
    self.items = items
    self.projects = projects
    self.contentSize = contentSize
    self.dropPlaceholderFrame = dropPlaceholderFrame
    self.highlightedProjectID = highlightedProjectID
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
    var items: [Item] = []
    var y = Self.initialY
    var dropPlaceholderFrame: CGRect?
    var previousVisibleEntry: TerminalSidebarEntry?

    for (index, entry) in entries.enumerated() {
      if insertionIndex == index, dropGapHeight > 0 {
        dropPlaceholderFrame = Self.placeholderFrame(
          y: y,
          height: dropGapHeight,
          width: width
        )
        y += dropGapHeight
      }

      let isDragged = draggedIDs.contains(entry.id)
      let visibility = visibilityByEntryID[entry.id] ?? .visible
      if y > Self.initialY, !isDragged {
        y += Self.spacing(before: entry, previous: previousVisibleEntry) * visibility.height
      }
      let preferredHeight = preferredHeights[entry.id] ?? Self.defaultHeight(for: entry)
      let height = isDragged ? 0 : preferredHeight * visibility.height
      let horizontalInsets = Self.horizontalInsets(for: entry)
      items.append(
        Item(
          id: entry.id,
          frame: CGRect(
            x: horizontalInsets.leading,
            y: y,
            width: horizontalInsets.width(in: width),
            height: height
          ),
          alpha: isDragged ? 0 : visibility.alpha
        )
      )
      y += height
      if !isDragged {
        previousVisibleEntry = entry
      }
    }

    if insertionIndex == entries.count, dropGapHeight > 0 {
      dropPlaceholderFrame = Self.placeholderFrame(
        y: y,
        height: dropGapHeight,
        width: width
      )
      y += dropGapHeight
    }

    let itemByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    let projects = Self.projects(
      entries: entries,
      itemByID: itemByID,
      dropPlaceholderFrame: dropPlaceholderFrame,
      destinationProjectID: dragDropState?.target?.destinationProjectID
    )
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
    self.projects = projects
    contentSize = CGSize(
      width: width,
      height: max(0, y + Self.rootSpacing + Self.bottomPadding)
    )
    self.dropPlaceholderFrame = dropPlaceholderFrame
    highlightedProjectID = dragDropState?.target?.highlightedProjectID
    semanticTargets = targetGeometry
  }

  func semanticTarget(at pointerY: CGFloat) -> TerminalSidebarSemanticTarget? {
    semanticTargets.first { target in
      pointerY >= target.frame.minY && pointerY < target.frame.maxY
    }
  }

  func projectID(at point: CGPoint) -> TerminalProjectID? {
    projects.first { $0.frame.contains(point) }?.id
  }

  func revealFrame(for entry: TerminalSidebarEntry) -> CGRect? {
    guard let itemFrame = items.first(where: { $0.id == entry.id })?.frame else {
      return nil
    }
    guard let projectID = entry.parentProjectID,
      let projectFrame = projects.first(where: { $0.id == projectID })?.frame
    else {
      return itemFrame
    }
    return projectFrame
  }

  func interpolated(from origin: Self, progress: CGFloat) -> Self {
    let progress = max(0, min(progress, 1))
    let originItems = Dictionary(uniqueKeysWithValues: origin.items.map { ($0.id, $0) })
    let originProjects = Dictionary(uniqueKeysWithValues: origin.projects.map { ($0.id, $0) })
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
      projects: projects.map { target in
        let source =
          originProjects[target.id]
          ?? Project(
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
        return Project(
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
      highlightedProjectID: highlightedProjectID,
      semanticTargets: semanticTargets
    )
  }

  private static func projects(
    entries: [TerminalSidebarEntry],
    itemByID: [TerminalSidebarEntryID: Item],
    dropPlaceholderFrame: CGRect?,
    destinationProjectID: TerminalProjectID?
  ) -> [Project] {
    entries.compactMap { entry -> Project? in
      guard case .project(let id, let color, _, _) = entry.kind,
        let header = itemByID[entry.id],
        header.frame.height > 0
      else { return nil }
      let descendants = entries.drop { $0.id != entry.id }.dropFirst().prefix { descendant in
        switch descendant.kind {
        case .tab(_, let parentProjectID, _): parentProjectID == id
        case .project, .unassigned, .pinDivider, .newTab: false
        }
      }
      let descendantFrames = descendants.compactMap { itemByID[$0.id]?.frame }.filter {
        $0.height > 0
      }
      let projectedFrames =
        id == destinationProjectID
        ? descendantFrames + [dropPlaceholderFrame].compactMap { $0 }
        : descendantFrames
      let frame = projectedFrames.reduce(header.frame) { $0.union($1) }
      return Project(
        id: id,
        color: color,
        frame: frame.insetBy(dx: 0, dy: -TerminalSidebarLayout.projectSurfaceOverflow),
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
    case .project(let projectID, _, let tabIDs):
      return projectTargetGeometry(
        rootIndex: rootIndex,
        projectID: projectID,
        tabIDs: tabIDs,
        context: context
      )
    case .unassigned(let tabIDs):
      return unassignedTargetGeometry(tabIDs: tabIDs, context: context)
    }
  }

  private static func unassignedTargetGeometry(
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    guard let header = context.itemByID[.unassigned] else {
      return RootTargetGeometry(targets: [], tabsEndY: initialY)
    }
    if context.outline.isUnassignedCollapsed || tabIDs.isEmpty {
      return RootTargetGeometry(
        targets: [
          TerminalSidebarSemanticTarget(
            path: .unassignedHeader,
            frame: CGRect(
              x: 0,
              y: header.frame.minY,
              width: context.width + 26,
              height: header.frame.height
            )
          )
        ],
        tabsEndY: header.frame.maxY
      )
    }
    let childFrames = tabIDs.compactMap { context.itemByID[.tab($0)]?.frame }
    let childEndY = childFrames.map(\.maxY).max() ?? header.frame.maxY
    var targets = [
      TerminalSidebarSemanticTarget(
        path: .unassignedHeader,
        frame: CGRect(
          x: 3,
          y: header.frame.minY,
          width: context.width,
          height: header.frame.height
        )
      )
    ]
    targets.append(contentsOf: unassignedChildTargets(tabIDs: tabIDs, context: context))
    return RootTargetGeometry(
      targets: targets,
      tabsEndY: childEndY + expandedProjectTrailingSpacing
    )
  }

  private static func projectTargetGeometry(
    rootIndex: Int,
    projectID: TerminalProjectID,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    guard let header = context.itemByID[.project(projectID)] else {
      return RootTargetGeometry(targets: [], tabsEndY: initialY)
    }
    let projectIsDragged = context.draggedIDs.contains(.project(projectID))
    if context.outline.collapsedProjectIDs.contains(projectID) || tabIDs.isEmpty {
      let topTargetHeight = ceil(header.frame.height / 2)
      var targets: [TerminalSidebarSemanticTarget] = []
      if !projectIsDragged {
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
            path: .project(projectID, index: tabIDs.count),
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
    let containerMaxY = childEndY + expandedProjectTrailingSpacing
    guard !projectIsDragged else {
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
          height: max(0, header.frame.height - expandedProjectTrailingSpacing)
        )
      ),
    ]
    targets.append(contentsOf: childTargets(projectID: projectID, tabIDs: tabIDs, context: context))
    let exitTargetHeight = expandedProjectExitTargetHeight(
      containerMaxY: containerMaxY,
      rootIndex: rootIndex,
      context: context
    )
    if context.sourceIsTab, exitTargetHeight > 0 {
      targets.append(
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(index: rootIndex, affinity: .after),
          frame: CGRect(
            x: 0,
            y: containerMaxY,
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

  private static func expandedProjectExitTargetHeight(
    containerMaxY: CGFloat,
    rootIndex: Int,
    context: TargetGeometryContext
  ) -> CGFloat {
    guard let root = context.outline.roots[safe: rootIndex] else { return 0 }
    guard
      let nextRoot = context.outline.roots.dropFirst(rootIndex + 1).first(where: {
        !context.draggedIDs.contains($0.entryID)
      })
    else { return 0 }
    guard root.isPinned == nextRoot.isPinned,
      let nextItem = context.itemByID[nextRoot.entryID]
    else { return 0 }
    return max(0, nextItem.frame.minY - containerMaxY)
  }

  private static func childTargets(
    projectID: TerminalProjectID,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    let visibleChildren: [(index: Int, item: Item)] = tabIDs.enumerated().compactMap {
      childIndex, tabID in
      guard
        let item = context.itemByID[.tab(tabID)],
        !context.draggedIDs.contains(.tab(tabID))
      else { return nil }
      return (index: childIndex, item: item)
    }
    guard let lastChild = visibleChildren.last else { return [] }

    var targets = visibleChildren.dropLast().map { childIndex, item in
      TerminalSidebarSemanticTarget(
        path: .project(projectID, index: childIndex),
        frame: CGRect(
          x: 0,
          y: item.frame.minY,
          width: context.width,
          height: item.frame.height
        )
      )
    }
    let (lastChildIndex, lastItem) = lastChild
    let splitY = lastItem.frame.midY
    targets.append(
      TerminalSidebarSemanticTarget(
        path: .project(projectID, index: lastChildIndex),
        frame: CGRect(
          x: 0,
          y: lastItem.frame.minY,
          width: context.width,
          height: splitY - lastItem.frame.minY
        )
      )
    )
    targets.append(
      TerminalSidebarSemanticTarget(
        path: .project(projectID, index: tabIDs.count),
        frame: CGRect(
          x: 0,
          y: splitY,
          width: context.width,
          height: lastItem.frame.maxY - splitY + expandedProjectTrailingSpacing
        )
      )
    )
    return targets
  }

  private static func unassignedChildTargets(
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    let visibleChildren: [(index: Int, item: Item)] = tabIDs.enumerated().compactMap {
      childIndex, tabID in
      guard
        let item = context.itemByID[.tab(tabID)],
        !context.draggedIDs.contains(.tab(tabID))
      else { return nil }
      return (index: childIndex, item: item)
    }
    guard let lastChild = visibleChildren.last else { return [] }
    var targets = visibleChildren.dropLast().map { childIndex, item in
      TerminalSidebarSemanticTarget(
        path: .unassigned(index: childIndex),
        frame: CGRect(
          x: 0,
          y: item.frame.minY,
          width: context.width,
          height: item.frame.height
        )
      )
    }
    let (lastChildIndex, lastItem) = lastChild
    let splitY = lastItem.frame.midY
    targets.append(
      TerminalSidebarSemanticTarget(
        path: .unassigned(index: lastChildIndex),
        frame: CGRect(
          x: 0,
          y: lastItem.frame.minY,
          width: context.width,
          height: splitY - lastItem.frame.minY
        )
      )
    )
    targets.append(
      TerminalSidebarSemanticTarget(
        path: .unassigned(index: tabIDs.count),
        frame: CGRect(
          x: 0,
          y: splitY,
          width: context.width,
          height: lastItem.frame.maxY - splitY + expandedProjectTrailingSpacing
        )
      )
    )
    return targets
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
    case .projectEnd(let projectID):
      guard let header = entries.firstIndex(where: { $0.id == .project(projectID) }) else {
        return entries.count
      }
      return entries[(header + 1)...].firstIndex { entry in
        switch entry.kind {
        case .project, .unassigned, .pinDivider, .newTab: true
        case .tab(_, let parentProjectID, _): parentProjectID != projectID
        }
      } ?? entries.count
    case .unassignedEnd:
      guard let header = entries.firstIndex(where: { $0.id == .unassigned }) else {
        return entries.firstIndex { $0.id == .newTab } ?? entries.count
      }
      return entries[(header + 1)...].firstIndex { entry in
        switch entry.kind {
        case .newTab: true
        case .tab, .project, .unassigned, .pinDivider: false
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
    width: CGFloat
  ) -> CGRect {
    let insets = TerminalSidebarLayout.cardHorizontalInsets
    return CGRect(
      x: insets.leading,
      y: y,
      width: insets.width(in: width),
      height: height
    )
  }

  private static func spacing(
    before entry: TerminalSidebarEntry,
    previous: TerminalSidebarEntry?
  ) -> CGFloat {
    switch (previous?.kind, entry.kind) {
    case (_, .newTab):
      rootSpacing
    case (_, .pinDivider):
      pinDividerTopSpacing
    case (.pinDivider, .project):
      TerminalSidebarLayout.tabRowSpacing + TerminalSidebarLayout.projectSurfaceOverflow
    case (.pinDivider, _):
      TerminalSidebarLayout.tabRowSpacing
    case (.tab(_, .some, _), .unassigned),
      (.project, .unassigned):
      rootSpacing
    case (_, .project), (_, .unassigned):
      rootSpacing
    default:
      TerminalSidebarLayout.tabRowSpacing
    }
  }

  private static func defaultHeight(for entry: TerminalSidebarEntry) -> CGFloat {
    switch entry.kind {
    case .pinDivider: dividerHeight
    case .newTab: TerminalSidebarLayout.newTabRowHeight
    case .tab, .project, .unassigned: TerminalSidebarLayout.tabRowMinHeight
    }
  }

  private static func horizontalInsets(
    for entry: TerminalSidebarEntry
  ) -> TerminalSidebarLayout.HorizontalInsets {
    switch entry.kind {
    case .pinDivider, .newTab:
      TerminalSidebarLayout.HorizontalInsets(leading: 0, trailing: 0)
    case .tab, .project, .unassigned:
      TerminalSidebarLayout.cardHorizontalInsets
    }
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
  private struct StructuralUpdate {
    let sourceIdentifiers: [TerminalSidebarEntryID]
    let sourceItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item]
  }

  private(set) var outline = TerminalSidebarOutline(
    roots: [],
    collapsedProjectIDs: [],
    topologyRevision: 0
  )
  var visibilityByEntryID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility] = [:]
  var dragDropState: TerminalSidebarDragDropState?
  var isNewTabItemHidden = false
  var preferredHeight: ((TerminalSidebarEntryID, CGFloat) -> CGFloat)?
  var itemIdentifiers: (() -> [TerminalSidebarEntryID])?

  private(set) var plan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedProjectIDs: [], topologyRevision: 0),
    preferredHeights: [:],
    dragDropState: nil,
    width: 0,
    viewportHeight: 0
  )
  private(set) var targetPlan = TerminalSidebarLayoutPlan(
    outline: TerminalSidebarOutline(roots: [], collapsedProjectIDs: [], topologyRevision: 0),
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
    let entries = outline.visibleEntries
    let heights = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        let itemWidth =
          switch entry.kind {
          case .pinDivider, .newTab: width
          case .tab, .project, .unassigned:
            TerminalSidebarLayout.cardHorizontalInsets.width(in: width)
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
    dropTargetMap = TerminalSidebarDropTargetMap(
      plan: targetPlan,
      activePath: dragDropState?.target?.path
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
