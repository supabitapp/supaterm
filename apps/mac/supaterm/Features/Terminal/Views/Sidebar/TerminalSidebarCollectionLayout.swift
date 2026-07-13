import AppKit

enum TerminalSidebarEntryID: Hashable {
  case project(TerminalProjectID)
  case tab(TerminalTabID)
  case newProject
}

struct TerminalSidebarEntry: Equatable {
  enum Kind: Equatable {
    case project(id: TerminalProjectID, isPinned: Bool)
    case tab(id: TerminalTabID, projectID: TerminalProjectID, isPinned: Bool)
    case newProject
  }

  let kind: Kind

  var id: TerminalSidebarEntryID {
    switch kind {
    case .project(let id, _):
      .project(id)
    case .tab(let id, _, _):
      .tab(id)
    case .newProject:
      .newProject
    }
  }
}

enum TerminalSidebarDragValue: Equatable {
  case project(TerminalProjectID)
  case tab(TerminalTabID)

  init?(pasteboardValue: String) {
    let components = pasteboardValue.split(separator: ":", maxSplits: 1).map(String.init)
    guard components.count == 2, let rawValue = UUID(uuidString: components[1]) else { return nil }
    switch components[0] {
    case "project":
      self = .project(TerminalProjectID(rawValue: rawValue))
    case "tab":
      self = .tab(TerminalTabID(rawValue: rawValue))
    default:
      return nil
    }
  }

  var pasteboardValue: String {
    switch self {
    case .project(let projectID):
      "project:\(projectID.rawValue.uuidString)"
    case .tab(let tabID):
      "tab:\(tabID.rawValue.uuidString)"
    }
  }
}

struct TerminalSidebarDropTarget: Equatable {
  enum Destination: Equatable {
    case project(isPinned: Bool, laneIndex: Int)
    case tab(projectID: TerminalProjectID, isPinned: Bool, laneIndex: Int)
  }

  let destination: Destination
  let insertionEntryIndex: Int

  var isTab: Bool {
    if case .tab = destination { return true }
    return false
  }
}

enum TerminalSidebarDropCommit {
  static func isApplied(
    drag: TerminalSidebarDragValue,
    destination: TerminalSidebarDropTarget.Destination,
    entries: [TerminalSidebarEntry]
  ) -> Bool {
    switch (drag, destination) {
    case (
      .project(let projectID),
      .project(let expectedPinned, let expectedLaneIndex)
    ):
      let projects = entries.filter { entry in
        if case .project = entry.kind { return true }
        return false
      }
      guard
        let index = projects.firstIndex(where: { $0.id == .project(projectID) }),
        case .project(_, let isPinned) = projects[index].kind
      else { return false }
      return isPinned == expectedPinned
        && projects[..<index].count(where: {
          guard case .project(_, let isPinned) = $0.kind else { return false }
          return isPinned == expectedPinned
        }) == expectedLaneIndex
    case (
      .tab(let tabID),
      .tab(let expectedProjectID, let expectedPinned, let expectedLaneIndex)
    ):
      let tabs = entries.filter { entry in
        if case .tab = entry.kind { return true }
        return false
      }
      guard
        let index = tabs.firstIndex(where: { $0.id == .tab(tabID) }),
        case .tab(_, let projectID, let isPinned) = tabs[index].kind
      else { return false }
      return projectID == expectedProjectID
        && isPinned == expectedPinned
        && tabs[..<index].count(where: {
          guard case .tab(_, let projectID, let isPinned) = $0.kind else { return false }
          return projectID == expectedProjectID && isPinned == expectedPinned
        }) == expectedLaneIndex
    default:
      return false
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

  static let horizontalInset: CGFloat = 8.5
  static let projectSpacing: CGFloat = 8

  let items: [Item]
  let contentSize: CGSize
  let dropIndicatorFrame: CGRect?

  private init(
    items: [Item],
    contentSize: CGSize,
    dropIndicatorFrame: CGRect?
  ) {
    self.items = items
    self.contentSize = contentSize
    self.dropIndicatorFrame = dropIndicatorFrame
  }

  init(
    entries: [TerminalSidebarEntry],
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    expansionProgress: [TerminalProjectID: CGFloat],
    visibilityByEntryID: [TerminalSidebarEntryID: Visibility] = [:],
    draggedEntryIDs: Set<TerminalSidebarEntryID>,
    dropTarget: TerminalSidebarDropTarget?,
    width: CGFloat
  ) {
    let itemWidth = max(1, width - Self.horizontalInset * 2)
    var items: [Item] = []
    var y: CGFloat = 0
    var dropIndicatorFrame: CGRect?
    let dropGapHeight = Self.dropGapHeight(
      entries: entries,
      preferredHeights: preferredHeights,
      expansionProgress: expansionProgress,
      draggedEntryIDs: draggedEntryIDs,
      dropTarget: dropTarget
    )

    for (index, entry) in entries.enumerated() {
      if dropTarget?.insertionEntryIndex == index {
        dropIndicatorFrame = Self.indicatorFrame(
          y: y + dropGapHeight / 2,
          width: itemWidth,
          isTab: dropTarget?.isTab == true
        )
        y += dropGapHeight
      }

      let isDragged = dropTarget != nil && draggedEntryIDs.contains(entry.id)
      let visibility = Self.visibility(
        for: entry,
        expansionProgress: expansionProgress,
        visibilityByEntryID: visibilityByEntryID
      )
      if y > 0, !isDragged {
        switch entry.kind {
        case .project, .newProject:
          y += Self.projectSpacing
        case .tab:
          y += TerminalSidebarLayout.tabRowSpacing * visibility.height
        }
      }

      let preferredHeight = preferredHeights[entry.id] ?? TerminalSidebarLayout.tabRowMinHeight
      let height = isDragged ? 0 : preferredHeight * visibility.height
      let alpha = isDragged ? 0 : visibility.alpha
      items.append(
        Item(
          id: entry.id,
          frame: CGRect(x: Self.horizontalInset, y: y, width: itemWidth, height: height),
          alpha: alpha
        )
      )
      y += height
    }

    if dropTarget?.insertionEntryIndex == entries.count {
      dropIndicatorFrame = Self.indicatorFrame(
        y: y + dropGapHeight / 2,
        width: itemWidth,
        isTab: dropTarget?.isTab == true
      )
      y += dropGapHeight
    }

    self.items = items
    self.contentSize = CGSize(width: width, height: y + Self.projectSpacing)
    self.dropIndicatorFrame = dropIndicatorFrame
  }

  func interpolated(from origin: Self, progress: CGFloat) -> Self {
    let progress = max(0, min(progress, 1))
    let originByID = Dictionary(uniqueKeysWithValues: origin.items.map { ($0.id, $0) })
    return Self(
      items: items.map { target in
        let origin =
          originByID[target.id]
          ?? Item(
            id: target.id,
            frame: target.frame.offsetBy(dx: 0, dy: -6),
            alpha: 0
          )
        return Item(
          id: target.id,
          frame: CGRect(
            x: origin.frame.minX + (target.frame.minX - origin.frame.minX) * progress,
            y: origin.frame.minY + (target.frame.minY - origin.frame.minY) * progress,
            width: origin.frame.width + (target.frame.width - origin.frame.width) * progress,
            height: origin.frame.height + (target.frame.height - origin.frame.height) * progress
          ),
          alpha: origin.alpha + (target.alpha - origin.alpha) * progress
        )
      },
      contentSize: CGSize(
        width: origin.contentSize.width + (contentSize.width - origin.contentSize.width) * progress,
        height: origin.contentSize.height + (contentSize.height - origin.contentSize.height) * progress
      ),
      dropIndicatorFrame: dropIndicatorFrame
    )
  }

  private static func indicatorFrame(y: CGFloat, width: CGFloat, isTab: Bool) -> CGRect {
    let indentation: CGFloat = isTab ? 12 : 0
    return CGRect(
      x: horizontalInset + indentation,
      y: y - 1,
      width: max(1, width - indentation),
      height: 2
    )
  }

  private static func visibility(
    for entry: TerminalSidebarEntry,
    expansionProgress: [TerminalProjectID: CGFloat],
    visibilityByEntryID: [TerminalSidebarEntryID: Visibility]
  ) -> Visibility {
    switch entry.kind {
    case .tab(_, let projectID, _):
      let progress = max(0, min(expansionProgress[projectID] ?? 1, 1))
      return visibilityByEntryID[entry.id] ?? Visibility(height: progress, alpha: progress)
    case .project, .newProject:
      return .visible
    }
  }

  private static func dropGapHeight(
    entries: [TerminalSidebarEntry],
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    expansionProgress: [TerminalProjectID: CGFloat],
    draggedEntryIDs: Set<TerminalSidebarEntryID>,
    dropTarget: TerminalSidebarDropTarget?
  ) -> CGFloat {
    guard let dropTarget else { return 0 }
    switch dropTarget.destination {
    case .tab(let projectID, _, _):
      guard let entry = entries.first(where: { draggedEntryIDs.contains($0.id) }) else { return 0 }
      let visibility = max(0, min(expansionProgress[projectID] ?? 1, 1))
      return
        ((preferredHeights[entry.id] ?? TerminalSidebarLayout.tabRowMinHeight)
        + TerminalSidebarLayout.tabRowSpacing) * visibility
    case .project:
      let draggedEntries = entries.filter { draggedEntryIDs.contains($0.id) }
      guard !draggedEntries.isEmpty else { return 0 }
      return draggedEntries.enumerated().reduce(
        dropTarget.insertionEntryIndex > 0 ? Self.projectSpacing : 0
      ) { height, element in
        let (index, entry) = element
        let visibility: CGFloat
        let spacing: CGFloat
        switch entry.kind {
        case .project, .newProject:
          visibility = 1
          spacing = 0
        case .tab(_, let projectID, _):
          visibility = max(0, min(expansionProgress[projectID] ?? 1, 1))
          spacing = index > 0 ? TerminalSidebarLayout.tabRowSpacing * visibility : 0
        }
        return height
          + spacing
          + (preferredHeights[entry.id] ?? TerminalSidebarLayout.tabRowMinHeight) * visibility
      }
    }
  }
}

enum TerminalSidebarDropTargetResolver {
  static func resolve(
    drag: TerminalSidebarDragValue,
    pointerY: CGFloat,
    entries: [TerminalSidebarEntry],
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    switch drag {
    case .project(let projectID):
      resolveProject(
        projectID: projectID,
        pointerY: pointerY,
        entries: entries,
        frames: frames
      )
    case .tab(let tabID):
      resolveTab(
        tabID: tabID,
        pointerY: pointerY,
        entries: entries,
        frames: frames
      )
    }
  }

  private static func resolveProject(
    projectID: TerminalProjectID,
    pointerY: CGFloat,
    entries: [TerminalSidebarEntry],
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    guard
      let source = entries.first(where: {
        if case .project(let id, _) = $0.kind { return id == projectID }
        return false
      }),
      case .project(_, let sourcePinned) = source.kind
    else { return nil }

    let projects = entries.compactMap { entry -> (entry: TerminalSidebarEntry, pinned: Bool)? in
      guard case .project(let id, let pinned) = entry.kind, id != projectID else { return nil }
      return (entry, pinned)
    }
    let insertionOffset =
      projects.firstIndex { project in
        pointerY < (frames[project.entry.id]?.midY ?? .greatestFiniteMagnitude)
      } ?? projects.count
    let targetPinned = pinLane(
      pointerY: pointerY,
      previous: projects[safe: insertionOffset - 1].map { ($0.entry, $0.pinned) },
      next: projects[safe: insertionOffset].map { ($0.entry, $0.pinned) },
      fallback: sourcePinned,
      frames: frames
    )
    let laneIndex = projects.prefix(insertionOffset).count { $0.pinned == targetPinned }
    return TerminalSidebarDropTarget(
      destination: .project(isPinned: targetPinned, laneIndex: laneIndex),
      insertionEntryIndex: projectInsertionIndex(
        isPinned: targetPinned,
        laneIndex: laneIndex,
        sourceProjectID: projectID,
        entries: entries
      )
    )
  }

  private static func resolveTab(
    tabID: TerminalTabID,
    pointerY: CGFloat,
    entries: [TerminalSidebarEntry],
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    guard
      let source = entries.first(where: {
        if case .tab(let id, _, _) = $0.kind { return id == tabID }
        return false
      }),
      case .tab(_, _, let sourcePinned) = source.kind
    else { return nil }

    if let newProjectEntry = entries.first(where: { $0.id == .newProject }),
      let newProjectFrame = frames[newProjectEntry.id],
      pointerY >= newProjectFrame.minY
    {
      return nil
    }

    let projectHeaders = entries.compactMap { entry -> (entry: TerminalSidebarEntry, id: TerminalProjectID)? in
      guard case .project(let id, _) = entry.kind else { return nil }
      return (entry, id)
    }
    guard
      let targetProject = projectHeaders.last(where: { header in
        pointerY >= (frames[header.entry.id]?.minY ?? 0)
      }) ?? projectHeaders.first
    else { return nil }

    let headerFrame = frames[targetProject.entry.id] ?? .zero
    let tabs = entries.compactMap { entry -> (entry: TerminalSidebarEntry, pinned: Bool)? in
      guard case .tab(let id, let projectID, let pinned) = entry.kind,
        projectID == targetProject.id,
        id != tabID
      else { return nil }
      return (entry, pinned)
    }
    let visibleTabs = tabs.filter { (frames[$0.entry.id]?.height ?? 0) > 0 }
    let isHeaderDrop =
      visibleTabs.isEmpty
      || headerFrame.contains(CGPoint(x: headerFrame.midX, y: pointerY))
    let insertionOffset =
      isHeaderDrop
      ? tabs.count
      : visibleTabs.firstIndex { tab in
        pointerY < (frames[tab.entry.id]?.midY ?? .greatestFiniteMagnitude)
      } ?? visibleTabs.count
    let targetPinned =
      isHeaderDrop
      ? sourcePinned
      : pinLane(
        pointerY: pointerY,
        previous: visibleTabs[safe: insertionOffset - 1].map { ($0.entry, $0.pinned) },
        next: visibleTabs[safe: insertionOffset].map { ($0.entry, $0.pinned) },
        fallback: sourcePinned,
        frames: frames
      )
    let laneIndex = (isHeaderDrop ? tabs[...] : visibleTabs.prefix(insertionOffset)).count {
      $0.pinned == targetPinned
    }
    return TerminalSidebarDropTarget(
      destination: .tab(
        projectID: targetProject.id,
        isPinned: targetPinned,
        laneIndex: laneIndex
      ),
      insertionEntryIndex: tabInsertionIndex(
        projectID: targetProject.id,
        isPinned: targetPinned,
        laneIndex: laneIndex,
        sourceTabID: tabID,
        entries: entries
      )
    )
  }

  private static func pinLane(
    pointerY: CGFloat,
    previous: (TerminalSidebarEntry, Bool)?,
    next: (TerminalSidebarEntry, Bool)?,
    fallback: Bool,
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> Bool {
    let previousFrame = previous.flatMap { frames[$0.0.id] }
    let nextFrame = next.flatMap { frames[$0.0.id] }
    switch (previous, previousFrame, next, nextFrame) {
    case (_, _, let next?, let nextFrame?) where pointerY >= nextFrame.minY:
      return next.1
    case (let previous?, _, .some, _):
      return previous.1
    case (nil, nil, let next?, _):
      return next.1
    case (let previous?, let previousFrame?, nil, nil) where pointerY <= previousFrame.maxY:
      return previous.1
    default:
      return fallback
    }
  }

  private static func projectInsertionIndex(
    isPinned: Bool,
    laneIndex: Int,
    sourceProjectID: TerminalProjectID,
    entries: [TerminalSidebarEntry]
  ) -> Int {
    let lane = entries.enumerated().compactMap { index, entry -> Int? in
      guard case .project(let id, let pinned) = entry.kind,
        id != sourceProjectID,
        pinned == isPinned
      else { return nil }
      return index
    }
    if lane.indices.contains(laneIndex) { return lane[laneIndex] }
    if isPinned,
      let firstRegular = entries.firstIndex(where: {
        if case .project(_, let pinned) = $0.kind { return !pinned }
        return false
      })
    {
      return firstRegular
    }
    return entries.firstIndex(where: { $0.id == .newProject }) ?? entries.count
  }

  private static func tabInsertionIndex(
    projectID: TerminalProjectID,
    isPinned: Bool,
    laneIndex: Int,
    sourceTabID: TerminalTabID,
    entries: [TerminalSidebarEntry]
  ) -> Int {
    let lane = entries.enumerated().compactMap { index, entry -> Int? in
      guard case .tab(let id, let ownerID, let pinned) = entry.kind,
        id != sourceTabID,
        ownerID == projectID,
        pinned == isPinned
      else { return nil }
      return index
    }
    if lane.indices.contains(laneIndex) { return lane[laneIndex] }
    if isPinned,
      let firstRegular = entries.firstIndex(where: {
        if case .tab(_, let ownerID, let pinned) = $0.kind {
          return ownerID == projectID && !pinned
        }
        return false
      })
    {
      return firstRegular
    }
    return projectBlockEnd(projectID: projectID, entries: entries)
  }

  private static func projectBlockEnd(
    projectID: TerminalProjectID,
    entries: [TerminalSidebarEntry]
  ) -> Int {
    guard
      let headerIndex = entries.firstIndex(where: {
        if case .project(let id, _) = $0.kind { return id == projectID }
        return false
      })
    else { return entries.count }
    return entries[(headerIndex + 1)...].firstIndex(where: {
      if case .project = $0.kind { return true }
      if case .newProject = $0.kind { return true }
      return false
    }) ?? entries.count
  }
}

enum TerminalSidebarAnimationCurve {
  static func standard(
    from: CGFloat,
    to: CGFloat,
    elapsed: TimeInterval,
    duration: TimeInterval
  ) -> CGFloat {
    guard duration > 0 else { return to }
    let linear = max(0, min(elapsed / duration, 1))
    let eased = cubicBezierProgress(
      linear,
      x1: 0.25,
      y1: 0.46,
      x2: 0.45,
      y2: 0.94
    )
    return from + (to - from) * eased
  }

  private static func cubicBezierProgress(
    _ progress: Double,
    x1: Double,
    y1: Double,
    x2: Double,
    y2: Double
  ) -> Double {
    var parameter = progress
    for _ in 0..<6 {
      let x = cubic(parameter, first: x1, second: x2)
      let derivative = cubicDerivative(parameter, first: x1, second: x2)
      guard abs(derivative) > 0.000_001 else { break }
      parameter = max(0, min(parameter - (x - progress) / derivative, 1))
    }
    return cubic(parameter, first: y1, second: y2)
  }

  private static func cubic(_ value: Double, first: Double, second: Double) -> Double {
    let inverse = 1 - value
    return 3 * inverse * inverse * value * first
      + 3 * inverse * value * value * second
      + value * value * value
  }

  private static func cubicDerivative(_ value: Double, first: Double, second: Double) -> Double {
    let inverse = 1 - value
    return 3 * inverse * inverse * first
      + 6 * inverse * value * (second - first)
      + 3 * value * value * (1 - second)
  }
}

final class TerminalSidebarCollectionLayout: NSCollectionViewLayout {
  private(set) var entries: [TerminalSidebarEntry] = []
  var expansionProgress: [TerminalProjectID: CGFloat] = [:]
  var visibilityByEntryID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility] = [:]
  var draggedEntryIDs: Set<TerminalSidebarEntryID> = []
  var dropTarget: TerminalSidebarDropTarget?
  var preferredHeight: ((TerminalSidebarEntryID, CGFloat) -> CGFloat)?
  var itemIdentifiers: (() -> [TerminalSidebarEntryID])?

  private(set) var plan = TerminalSidebarLayoutPlan(
    entries: [],
    preferredHeights: [:],
    expansionProgress: [:],
    draggedEntryIDs: [],
    dropTarget: nil,
    width: 0
  )
  private(set) var targetPlan = TerminalSidebarLayoutPlan(
    entries: [],
    preferredHeights: [:],
    expansionProgress: [:],
    draggedEntryIDs: [],
    dropTarget: nil,
    width: 0
  )
  private var transitionOrigin: TerminalSidebarLayoutPlan?
  private var transitionProgress: CGFloat = 1
  private var attributesByIndexPath: [IndexPath: NSCollectionViewLayoutAttributes] = [:]
  private var fallbackItemsByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item] = [:]
  private var preparedBoundsSize: CGSize = .zero

  func setEntries(_ entries: [TerminalSidebarEntry]) {
    if self.entries.map(\.id) != entries.map(\.id) {
      fallbackItemsByID = Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) })
    }
    self.entries = entries
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
  }

  override func prepare() {
    super.prepare()
    guard let collectionView else { return }
    preparedBoundsSize = collectionView.bounds.size
    rebuild(width: collectionView.bounds.width)
  }

  private func rebuild(width: CGFloat) {
    guard let collectionView else { return }
    let itemWidth = max(1, width - TerminalSidebarLayoutPlan.horizontalInset * 2)
    let heights = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        (entry.id, preferredHeight?(entry.id, itemWidth) ?? TerminalSidebarLayout.tabRowMinHeight)
      })
    targetPlan = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights,
      expansionProgress: expansionProgress,
      visibilityByEntryID: visibilityByEntryID,
      draggedEntryIDs: draggedEntryIDs,
      dropTarget: dropTarget,
      width: width
    )
    if let transitionOrigin, transitionOrigin.contentSize.width == targetPlan.contentSize.width {
      plan = targetPlan.interpolated(from: transitionOrigin, progress: transitionProgress)
    } else {
      finishTransition()
      plan = targetPlan
    }
    let itemCount = collectionView.numberOfSections > 0 ? collectionView.numberOfItems(inSection: 0) : 0
    let currentIdentifiers = itemIdentifiers?() ?? entries.map(\.id)
    let displayedIdentifiers =
      currentIdentifiers.count == itemCount ? currentIdentifiers : entries.map(\.id)
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
    let targetItemsByID = Dictionary(uniqueKeysWithValues: plan.items.map { ($0.id, $0) })
    return identifiers.prefix(itemCount).enumerated().compactMap { index, entryID in
      guard let item = targetItemsByID[entryID] ?? fallbackItemsByID[entryID] else { return nil }
      return (IndexPath(item: index, section: 0), item)
    }
  }

  override var collectionViewContentSize: NSSize {
    plan.contentSize
  }

  override func layoutAttributesForElements(in rect: NSRect) -> [NSCollectionViewLayoutAttributes] {
    attributesByIndexPath.values.filter { attributes in
      attributes.frame.height > 0 && attributes.frame.intersects(rect)
    }
  }

  override func layoutAttributesForItem(at indexPath: IndexPath) -> NSCollectionViewLayoutAttributes? {
    attributesByIndexPath[indexPath]
  }

  override func layoutAttributesForDropTarget(
    at pointInCollectionView: NSPoint
  ) -> NSCollectionViewLayoutAttributes? {
    guard let dropTarget else { return nil }
    return layoutAttributesForInterItemGap(
      before: IndexPath(
        item: min(dropTarget.insertionEntryIndex, entries.count),
        section: 0
      )
    )
  }

  override func layoutAttributesForInterItemGap(
    before indexPath: IndexPath
  ) -> NSCollectionViewLayoutAttributes? {
    guard indexPath.section == 0, indexPath.item <= entries.count else { return nil }
    let attributes = NSCollectionViewLayoutAttributes(forInterItemGapBefore: indexPath)
    if dropTarget?.insertionEntryIndex == indexPath.item,
      let frame = plan.dropIndicatorFrame
    {
      attributes.frame = frame
      return attributes
    }
    let y = plan.items[safe: indexPath.item]?.frame.minY ?? plan.contentSize.height
    attributes.frame = CGRect(
      x: TerminalSidebarLayoutPlan.horizontalInset,
      y: y - 1,
      width: max(1, plan.contentSize.width - TerminalSidebarLayoutPlan.horizontalInset * 2),
      height: 2
    )
    return attributes
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
