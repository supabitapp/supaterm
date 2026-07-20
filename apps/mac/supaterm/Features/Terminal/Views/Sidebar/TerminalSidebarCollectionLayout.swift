import AppKit

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
  static let rootSpacing: CGFloat = 6
  static let dividerHeight: CGFloat = 9

  let items: [Item]
  let groups: [Group]
  let contentSize: CGSize
  let dropIndicatorFrame: CGRect?
  let highlightedGroupID: TerminalTabGroupID?
  let highlightedTabID: TerminalTabID?

  private init(
    items: [Item],
    groups: [Group],
    contentSize: CGSize,
    dropIndicatorFrame: CGRect?,
    highlightedGroupID: TerminalTabGroupID?,
    highlightedTabID: TerminalTabID?
  ) {
    self.items = items
    self.groups = groups
    self.contentSize = contentSize
    self.dropIndicatorFrame = dropIndicatorFrame
    self.highlightedGroupID = highlightedGroupID
    self.highlightedTabID = highlightedTabID
  }

  init(
    entries: [TerminalSidebarEntry],
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    visibilityByEntryID: [TerminalSidebarEntryID: Visibility] = [:],
    draggedEntryIDs: Set<TerminalSidebarEntryID>,
    dropTarget: TerminalSidebarDropTarget?,
    width: CGFloat
  ) {
    let availableWidth = max(1, width - Self.horizontalInset * 2)
    let dropGapHeight = Self.dropGapHeight(
      entries: entries,
      preferredHeights: preferredHeights,
      draggedEntryIDs: draggedEntryIDs,
      dropTarget: dropTarget
    )
    var items: [Item] = []
    var y: CGFloat = 0
    var dropIndicatorFrame: CGRect?

    for (index, entry) in entries.enumerated() {
      if dropTarget?.insertionEntryIndex == index, dropGapHeight > 0 {
        dropIndicatorFrame = Self.indicatorFrame(
          y: y + dropGapHeight / 2,
          width: availableWidth,
          presentation: dropTarget?.presentation
        )
        y += dropGapHeight
      }

      let isDragged = dropTarget != nil && draggedEntryIDs.contains(entry.id)
      let visibility = visibilityByEntryID[entry.id] ?? .visible
      if y > 0, !isDragged {
        y += Self.spacing(before: entry, previous: entries[safe: index - 1]) * visibility.height
      }
      let indentation = Self.indentation(for: entry)
      let preferredHeight = preferredHeights[entry.id] ?? Self.defaultHeight(for: entry)
      let height = isDragged ? 0 : preferredHeight * visibility.height
      items.append(
        Item(
          id: entry.id,
          frame: CGRect(
            x: Self.horizontalInset + indentation,
            y: y,
            width: max(1, availableWidth - indentation),
            height: height
          ),
          alpha: isDragged ? 0 : visibility.alpha
        )
      )
      y += height
    }

    if dropTarget?.insertionEntryIndex == entries.count, dropGapHeight > 0 {
      dropIndicatorFrame = Self.indicatorFrame(
        y: y + dropGapHeight / 2,
        width: availableWidth,
        presentation: dropTarget?.presentation
      )
      y += dropGapHeight
    }

    let itemByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    let groups = entries.compactMap { entry -> Group? in
      guard case .group(let id, let color, _, _) = entry.kind,
        let header = itemByID[entry.id],
        header.frame.height > 0
      else { return nil }
      let descendants = entries.drop { $0.id != entry.id }.dropFirst().prefix { descendant in
        switch descendant.kind {
        case .tab(_, let parentGroupID, _): parentGroupID == id
        case .emptyGroup(let groupID): groupID == id
        case .group, .pinDivider, .newTab, .newGroup: false
        }
      }
      let descendantFrames = descendants.compactMap { itemByID[$0.id]?.frame }.filter { $0.height > 0 }
      let frame = descendantFrames.reduce(header.frame) { $0.union($1) }
      return Group(
        id: id,
        color: color,
        frame: frame.insetBy(dx: -2, dy: -2),
        alpha: header.alpha
      )
    }

    let highlightedGroupID: TerminalTabGroupID?
    let highlightedTabID: TerminalTabID?
    switch dropTarget?.presentation {
    case .groupHighlight(let id):
      highlightedGroupID = id
      highlightedTabID = nil
    case .combineHighlight(let id):
      highlightedGroupID = nil
      highlightedTabID = id
    case .rootGap, .groupGap, nil:
      highlightedGroupID = nil
      highlightedTabID = nil
    }

    self.items = items
    self.groups = groups
    contentSize = CGSize(width: width, height: y + Self.rootSpacing)
    self.dropIndicatorFrame = dropIndicatorFrame
    self.highlightedGroupID = highlightedGroupID
    self.highlightedTabID = highlightedTabID
  }

  func interpolated(from origin: Self, progress: CGFloat) -> Self {
    let progress = max(0, min(progress, 1))
    let originItems = Dictionary(uniqueKeysWithValues: origin.items.map { ($0.id, $0) })
    let originGroups = Dictionary(uniqueKeysWithValues: origin.groups.map { ($0.id, $0) })
    return Self(
      items: items.map { target in
        let source =
          originItems[target.id]
          ?? Item(
            id: target.id,
            frame: target.frame.offsetBy(dx: 0, dy: -6),
            alpha: 0
          )
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
        width: origin.contentSize.width + (contentSize.width - origin.contentSize.width) * progress,
        height: origin.contentSize.height + (contentSize.height - origin.contentSize.height) * progress
      ),
      dropIndicatorFrame: dropIndicatorFrame,
      highlightedGroupID: highlightedGroupID,
      highlightedTabID: highlightedTabID
    )
  }

  private static func interpolationValue(_ source: CGFloat, _ target: CGFloat, progress: CGFloat) -> CGFloat {
    source + (target - source) * progress
  }

  private static func interpolate(_ source: CGRect, _ target: CGRect, progress: CGFloat) -> CGRect {
    CGRect(
      x: interpolationValue(source.minX, target.minX, progress: progress),
      y: interpolationValue(source.minY, target.minY, progress: progress),
      width: interpolationValue(source.width, target.width, progress: progress),
      height: interpolationValue(source.height, target.height, progress: progress)
    )
  }

  private static func defaultHeight(for entry: TerminalSidebarEntry) -> CGFloat {
    if case .pinDivider = entry.kind { return dividerHeight }
    return TerminalSidebarLayout.tabRowMinHeight
  }

  private static func indentation(for entry: TerminalSidebarEntry) -> CGFloat {
    switch entry.kind {
    case .tab(_, .some, _), .emptyGroup:
      childIndentation
    case .tab(_, nil, _), .group, .pinDivider, .newTab, .newGroup:
      0
    }
  }

  private static func spacing(
    before entry: TerminalSidebarEntry,
    previous: TerminalSidebarEntry?
  ) -> CGFloat {
    switch (previous?.kind, entry.kind) {
    case (_, .pinDivider), (.pinDivider, _):
      0
    case (_, .group), (.tab(_, .some, _), .tab(_, nil, _)), (.emptyGroup, .tab(_, nil, _)):
      rootSpacing
    case (_, .newTab):
      rootSpacing
    default:
      TerminalSidebarLayout.tabRowSpacing
    }
  }

  private static func indicatorFrame(
    y: CGFloat,
    width: CGFloat,
    presentation: TerminalSidebarDropTarget.Presentation?
  ) -> CGRect {
    let indentation: CGFloat
    if case .groupGap = presentation {
      indentation = childIndentation
    } else {
      indentation = 0
    }
    return CGRect(
      x: horizontalInset + indentation,
      y: y - 1,
      width: max(1, width - indentation),
      height: 2
    )
  }

  private static func dropGapHeight(
    entries: [TerminalSidebarEntry],
    preferredHeights: [TerminalSidebarEntryID: CGFloat],
    draggedEntryIDs: Set<TerminalSidebarEntryID>,
    dropTarget: TerminalSidebarDropTarget?
  ) -> CGFloat {
    guard let dropTarget, dropTarget.insertionEntryIndex != nil else { return 0 }
    let dragged = entries.filter { draggedEntryIDs.contains($0.id) }
    guard !dragged.isEmpty else { return 0 }
    return dragged.enumerated().reduce(0) { total, element in
      let (index, entry) = element
      let spacing = index == 0 ? 0 : self.spacing(before: entry, previous: dragged[safe: index - 1])
      return total + spacing + (preferredHeights[entry.id] ?? defaultHeight(for: entry))
    }
  }
}

final class TerminalSidebarCollectionLayout: NSCollectionViewLayout {
  private(set) var entries: [TerminalSidebarEntry] = []
  var visibilityByEntryID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Visibility] = [:]
  var draggedEntryIDs: Set<TerminalSidebarEntryID> = []
  var dropTarget: TerminalSidebarDropTarget?
  var preferredHeight: ((TerminalSidebarEntryID, CGFloat) -> CGFloat)?
  var itemIdentifiers: (() -> [TerminalSidebarEntryID])?

  private(set) var plan = TerminalSidebarLayoutPlan(
    entries: [],
    preferredHeights: [:],
    draggedEntryIDs: [],
    dropTarget: nil,
    width: 0
  )
  private(set) var targetPlan = TerminalSidebarLayoutPlan(
    entries: [],
    preferredHeights: [:],
    draggedEntryIDs: [],
    dropTarget: nil,
    width: 0
  )
  private(set) var hitTestPlan = TerminalSidebarLayoutPlan(
    entries: [],
    preferredHeights: [:],
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
    plan = targetPlan
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
      }
    )
    hitTestPlan = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights,
      visibilityByEntryID: visibilityByEntryID,
      draggedEntryIDs: draggedEntryIDs,
      dropTarget: nil,
      width: width
    )
    targetPlan = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights,
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
    let identifiers = itemIdentifiers?() ?? entries.map(\.id)
    let displayedIdentifiers = identifiers.count == itemCount ? identifiers : entries.map(\.id)
    attributesByIndexPath = Dictionary(
      uniqueKeysWithValues: displayedItems(identifiers: displayedIdentifiers, itemCount: itemCount).map {
        indexPath, item in
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

  override func layoutAttributesForItem(at indexPath: IndexPath) -> NSCollectionViewLayoutAttributes? {
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
