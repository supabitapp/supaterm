import CoreGraphics
import SupaTheme

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
    let dropGapHeight =
      dragDropState?.dropGapHeight
      ?? Self.dropGapHeight(
        entries: entries,
        preferredHeights: preferredHeights,
        draggedItemIDs: dragDropState?.draggingItemIDs ?? [],
        insertionIndex: insertionIndex
      )
    let naturalGeometry = Self.itemGeometry(
      ItemGeometryContext(
        entries: entries,
        preferredHeights: preferredHeights,
        visibilityByEntryID: visibilityByEntryID,
        draggedIDs: [],
        insertionIndex: nil,
        naturalTargetGapY: nil,
        dropGapHeight: 0,
        width: width
      )
    )
    let naturalItemByID = Dictionary(
      uniqueKeysWithValues: naturalGeometry.items.map { ($0.id, $0) })
    let targetGeometry = Self.targetGeometry(
      TargetGeometryContext(
        outline: outline,
        itemByID: naturalItemByID,
        draggedIDs: draggedIDs,
        sourceIsTab: {
          guard let source = dragDropState?.source else { return false }
          if case .tabs = source { return true }
          return false
        }(),
        width: width,
        viewportHeight: viewportHeight
      )
    )
    let naturalTargetGapY = Self.naturalTargetGapY(
      for: dragDropState?.target,
      targets: targetGeometry
    )
    let projectedGeometry = Self.itemGeometry(
      ItemGeometryContext(
        entries: entries,
        preferredHeights: preferredHeights,
        visibilityByEntryID: visibilityByEntryID,
        draggedIDs: draggedIDs,
        insertionIndex: naturalTargetGapY == nil ? insertionIndex : nil,
        naturalTargetGapY: naturalTargetGapY,
        dropGapHeight: dropGapHeight,
        width: width
      )
    )
    let projectedItemByID = Dictionary(
      uniqueKeysWithValues: projectedGeometry.items.map { ($0.id, $0) }
    )
    let projects = Self.projects(
      entries: entries,
      itemByID: projectedItemByID,
      dropPlaceholderFrame: projectedGeometry.dropPlaceholderFrame,
      destinationProjectID: dragDropState?.target?.destinationProjectID
    )
    self.items = projectedGeometry.items
    self.projects = projects
    contentSize = CGSize(
      width: width,
      height: max(0, projectedGeometry.contentEndY + Self.rootSpacing + Self.bottomPadding)
    )
    self.dropPlaceholderFrame = projectedGeometry.dropPlaceholderFrame
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
      dropPlaceholderFrame: Self.interpolate(
        origin.dropPlaceholderFrame,
        dropPlaceholderFrame,
        progress: progress
      ),
      highlightedProjectID: highlightedProjectID,
      semanticTargets: semanticTargets
    )
  }

  private struct ItemGeometry {
    let items: [Item]
    let dropPlaceholderFrame: CGRect?
    let contentEndY: CGFloat
  }

  private struct ItemGeometryContext {
    let entries: [TerminalSidebarEntry]
    let preferredHeights: [TerminalSidebarEntryID: CGFloat]
    let visibilityByEntryID: [TerminalSidebarEntryID: Visibility]
    let draggedIDs: Set<TerminalSidebarEntryID>
    let insertionIndex: Int?
    let naturalTargetGapY: CGFloat?
    let dropGapHeight: CGFloat
    let width: CGFloat
  }

  private static func itemGeometry(_ context: ItemGeometryContext) -> ItemGeometry {
    var items: [Item] = []
    var y = Self.initialY
    var dropPlaceholderFrame: CGRect?
    var previousVisibleEntry: TerminalSidebarEntry?

    for (index, entry) in context.entries.enumerated() {
      if context.insertionIndex == index, context.dropGapHeight > 0 {
        dropPlaceholderFrame = Self.placeholderFrame(
          y: y,
          height: context.dropGapHeight,
          width: context.width
        )
        y += context.dropGapHeight
      }

      let isDragged = context.draggedIDs.contains(entry.id)
      let visibility = context.visibilityByEntryID[entry.id] ?? .visible
      if y > Self.initialY, !isDragged {
        y += Self.spacing(before: entry, previous: previousVisibleEntry) * visibility.height
      }
      if let naturalTargetGapY = context.naturalTargetGapY, dropPlaceholderFrame == nil,
        y >= naturalTargetGapY, context.dropGapHeight > 0
      {
        dropPlaceholderFrame = Self.placeholderFrame(
          y: naturalTargetGapY,
          height: context.dropGapHeight,
          width: context.width
        )
        y += context.dropGapHeight
      }
      let preferredHeight = context.preferredHeights[entry.id] ?? Self.defaultHeight(for: entry)
      let height = isDragged ? 0 : preferredHeight * visibility.height
      let horizontalInsets = Self.horizontalInsets(for: entry)
      items.append(
        Item(
          id: entry.id,
          frame: CGRect(
            x: horizontalInsets.leading,
            y: y,
            width: horizontalInsets.width(in: context.width),
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

    if context.insertionIndex == context.entries.count, context.dropGapHeight > 0 {
      dropPlaceholderFrame = Self.placeholderFrame(
        y: y,
        height: context.dropGapHeight,
        width: context.width
      )
      y += context.dropGapHeight
    }

    return ItemGeometry(
      items: items,
      dropPlaceholderFrame: dropPlaceholderFrame,
      contentEndY: y
    )
  }

  private static func naturalTargetGapY(
    for target: TerminalSidebarDropPlan?,
    targets: [TerminalSidebarSemanticTarget]
  ) -> CGFloat? {
    guard let target else { return nil }
    switch target.path {
    case .rootItem(_, _, let id):
      guard case .tab = id else { return nil }
    case .projectItem, .unassignedItem:
      break
    case .rootBoundary, .projectEntry, .projectBoundary, .unassignedEntry,
      .unassignedBoundary:
      return nil
    }
    return targets.first { $0.path == target.path }?.frame.minY
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

  private struct RootTargetPosition {
    let outlineIndex: Int
    let lane: TerminalSidebarRootLane
    let index: Int
  }

  private static func targetGeometry(
    _ context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    var targets: [TerminalSidebarSemanticTarget] = []
    var tabsEndY = Self.initialY
    var nextRootIndexByLane: [TerminalSidebarRootLane: Int] = [:]

    for (outlineIndex, root) in context.outline.roots.enumerated() {
      let lane = TerminalSidebarRootLane(isPinned: root.isPinned)
      let position = RootTargetPosition(
        outlineIndex: outlineIndex,
        lane: lane,
        index: nextRootIndexByLane[lane, default: 0]
      )
      if context.sourceIsTab {
        nextRootIndexByLane[lane] = position.index + 1
      } else if case .project = root.content {
        nextRootIndexByLane[lane] = position.index + 1
      }

      if outlineIndex > 0, context.outline.roots[outlineIndex - 1].isPinned, !root.isPinned,
        let divider = context.itemByID[.pinDivider]
      {
        targets.append(
          TerminalSidebarSemanticTarget(
            path: .rootBoundary(
              lane: .pinned,
              index: nextRootIndexByLane[.pinned, default: 0]
            ),
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
        position: position,
        root: root,
        context: context
      )
      targets.append(contentsOf: rootGeometry.targets)
      tabsEndY = max(tabsEndY, rootGeometry.tabsEndY)
    }

    targets.append(
      TerminalSidebarSemanticTarget(
        path: .rootBoundary(
          lane: .regular,
          index: nextRootIndexByLane[.regular, default: 0]
        ),
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
    position: RootTargetPosition,
    root: TerminalSidebarOutline.Root,
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    switch root.content {
    case .project(let projectID, _, let tabIDs):
      return projectTargetGeometry(
        position: position,
        projectID: projectID,
        tabIDs: tabIDs,
        context: context
      )
    case .unassigned(let tabIDs):
      return unassignedTargetGeometry(
        position: position,
        tabIDs: tabIDs,
        context: context
      )
    }
  }

  private static func unassignedTargetGeometry(
    position: RootTargetPosition,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    guard let header = context.itemByID[.unassigned] else {
      return RootTargetGeometry(targets: [], tabsEndY: initialY)
    }
    let leadingBoundary = TerminalSidebarSemanticTarget(
      path: .rootBoundary(lane: position.lane, index: position.index),
      frame: CGRect(
        x: 0,
        y: header.frame.minY,
        width: context.width,
        height: min(rootBoundaryTargetHeight, header.frame.height)
      )
    )
    if context.outline.isUnassignedCollapsed || tabIDs.isEmpty {
      return RootTargetGeometry(
        targets: [
          leadingBoundary,
          TerminalSidebarSemanticTarget(path: .unassignedEntry, frame: header.frame),
        ],
        tabsEndY: header.frame.maxY
      )
    }

    let childTargets = childTargets(projectID: nil, tabIDs: tabIDs, context: context)
    let semanticEndY = childTargets.last?.frame.maxY ?? header.frame.maxY
    var targets = [
      leadingBoundary,
      TerminalSidebarSemanticTarget(path: .unassignedEntry, frame: header.frame),
    ]
    targets.append(contentsOf: childTargets)
    let exitTargetHeight = expandedProjectExitTargetHeight(
      semanticEndY: semanticEndY,
      position: position,
      context: context
    )
    if exitTargetHeight > 0 {
      targets.append(
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(lane: position.lane, index: position.index + 1),
          frame: CGRect(
            x: 0,
            y: semanticEndY,
            width: context.width,
            height: exitTargetHeight
          )
        )
      )
    }
    return RootTargetGeometry(targets: targets, tabsEndY: semanticEndY)
  }

  private static func projectTargetGeometry(
    position: RootTargetPosition,
    projectID: TerminalProjectID,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    guard let header = context.itemByID[.project(projectID)] else {
      return RootTargetGeometry(targets: [], tabsEndY: initialY)
    }
    let projectIsDragged = context.draggedIDs.contains(.project(projectID))
    if context.outline.collapsedProjectIDs.contains(projectID) || tabIDs.isEmpty {
      return collapsedProjectTargetGeometry(
        position: position,
        projectID: projectID,
        header: header,
        projectIsDragged: projectIsDragged,
        context: context
      )
    }

    let childFrames = tabIDs.compactMap { tabID -> CGRect? in
      guard !context.draggedIDs.contains(.tab(tabID)) else { return nil }
      return context.itemByID[.tab(tabID)]?.frame
    }
    let childEndY = childFrames.map(\.maxY).max() ?? header.frame.maxY
    let visualContainerMaxY = childEndY + TerminalSidebarLayout.projectSurfaceOverflow
    guard !projectIsDragged else {
      return RootTargetGeometry(
        targets: [],
        tabsEndY: visualContainerMaxY
      )
    }
    let headerPath: TerminalSidebarSemanticPath =
      context.sourceIsTab
      ? .projectEntry(projectID)
      : .rootItem(lane: position.lane, index: position.index, id: .project(projectID))
    var targets = [
      TerminalSidebarSemanticTarget(
        path: .rootBoundary(lane: position.lane, index: position.index),
        frame: CGRect(
          x: 0,
          y: header.frame.minY,
          width: context.width,
          height: min(rootBoundaryTargetHeight, header.frame.height)
        )
      ),
      TerminalSidebarSemanticTarget(
        path: headerPath,
        frame: header.frame
      ),
    ]
    let childTargets = childTargets(projectID: projectID, tabIDs: tabIDs, context: context)
    targets.append(contentsOf: childTargets)
    let semanticEndY = childTargets.last?.frame.maxY ?? visualContainerMaxY
    let exitTargetHeight = expandedProjectExitTargetHeight(
      semanticEndY: semanticEndY,
      position: position,
      context: context
    )
    if context.sourceIsTab, exitTargetHeight > 0 {
      targets.append(
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(lane: position.lane, index: position.index + 1),
          frame: CGRect(
            x: 0,
            y: semanticEndY,
            width: context.width,
            height: exitTargetHeight
          )
        )
      )
    }
    return RootTargetGeometry(
      targets: targets,
      tabsEndY: semanticEndY
    )
  }

  private static func collapsedProjectTargetGeometry(
    position: RootTargetPosition,
    projectID: TerminalProjectID,
    header: Item,
    projectIsDragged: Bool,
    context: TargetGeometryContext
  ) -> RootTargetGeometry {
    let topTargetHeight = ceil(header.frame.height / 2)
    let headerPath: TerminalSidebarSemanticPath =
      context.sourceIsTab
      ? .projectEntry(projectID)
      : .rootItem(lane: position.lane, index: position.index, id: .project(projectID))
    let targets: [TerminalSidebarSemanticTarget]
    if projectIsDragged {
      targets = []
    } else {
      targets = [
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(lane: position.lane, index: position.index),
          frame: CGRect(
            x: 0,
            y: header.frame.minY,
            width: context.width,
            height: min(rootBoundaryTargetHeight, header.frame.height)
          )
        ),
        TerminalSidebarSemanticTarget(
          path: headerPath,
          frame: CGRect(
            x: 0,
            y: header.frame.minY,
            width: context.width + 26,
            height: topTargetHeight
          )
        ),
        TerminalSidebarSemanticTarget(
          path: .rootBoundary(lane: position.lane, index: position.index + 1),
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

  private static func expandedProjectExitTargetHeight(
    semanticEndY: CGFloat,
    position: RootTargetPosition,
    context: TargetGeometryContext
  ) -> CGFloat {
    guard context.outline.roots.indices.contains(position.outlineIndex) else { return 0 }
    let remainingRoots = context.outline.roots.dropFirst(position.outlineIndex + 1)
    var nextRoot: TerminalSidebarOutline.Root?
    for candidate in remainingRoots where !context.draggedIDs.contains(candidate.id) {
      nextRoot = candidate
      break
    }
    guard let nextRoot else { return 0 }
    guard position.lane.isPinned == nextRoot.isPinned,
      let nextItem = context.itemByID[nextRoot.id]
    else { return 0 }
    return max(0, nextItem.frame.minY - semanticEndY)
  }

  private static func childTargets(
    projectID: TerminalProjectID?,
    tabIDs: [TerminalTabID],
    context: TargetGeometryContext
  ) -> [TerminalSidebarSemanticTarget] {
    struct VisibleChild {
      let index: Int
      let id: TerminalTabID
      let item: Item
    }
    let visibleChildren = tabIDs.enumerated()
      .compactMap { childIndex, tabID -> VisibleChild? in
        guard
          let item = context.itemByID[.tab(tabID)],
          !context.draggedIDs.contains(.tab(tabID))
        else { return nil }
        return VisibleChild(index: childIndex, id: tabID, item: item)
      }
    guard let lastChild = visibleChildren.last else { return [] }

    var targets = visibleChildren.map { child in
      let path =
        projectID.map { TerminalSidebarSemanticPath.projectItem($0, index: child.index, id: child.id) }
        ?? .unassignedItem(index: child.index, id: child.id)
      return TerminalSidebarSemanticTarget(path: path, frame: child.item.frame)
    }
    let boundaryPath =
      projectID.map { TerminalSidebarSemanticPath.projectBoundary($0, index: tabIDs.count) }
      ?? .unassignedBoundary(index: tabIDs.count)
    targets.append(
      TerminalSidebarSemanticTarget(
        path: boundaryPath,
        frame: CGRect(
          x: 0,
          y: lastChild.item.frame.maxY,
          width: context.width,
          height: rootBoundaryTargetHeight
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
        case .project, .unassigned, .pinDivider, .newTab: true
        case .tab(_, let parentProjectID, _): parentProjectID != nil
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
    case (.pinDivider, .project), (.pinDivider, .unassigned):
      TerminalSidebarLayout.tabRowSpacing + TerminalSidebarLayout.projectSurfaceOverflow
    case (.pinDivider, _):
      TerminalSidebarLayout.tabRowSpacing
    case (.tab(_, .some, _), .tab(_, nil, _)),
      (.project, .tab(_, nil, _)),
      (.unassigned, .project):
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

  private static func interpolate(
    _ source: CGRect?,
    _ target: CGRect?,
    progress: CGFloat
  ) -> CGRect? {
    if progress <= 0 { return source }
    if progress >= 1 { return target }
    switch (source, target) {
    case (.some(let source), .some(let target)):
      return interpolate(source, target, progress: progress)
    case (.some(let source), nil):
      return interpolate(
        source,
        CGRect(x: source.minX, y: source.minY, width: source.width, height: 0),
        progress: progress
      )
    case (nil, .some(let target)):
      return interpolate(
        CGRect(x: target.minX, y: target.minY, width: target.width, height: 0),
        target,
        progress: progress
      )
    case (nil, nil):
      return nil
    }
  }
}
