import CoreGraphics

enum TerminalHorizontalTabLayoutMetrics {
  static let closeButtonSize: CGFloat = 22
  static let closeButtonTrailingInset: CGFloat = 6
  static let controlWidth: CGFloat = 32
  static let groupSurfaceHorizontalInset: CGFloat = 2
  static let groupSurfaceVerticalInset: CGFloat = 2
  static let groupLabelLeadingInset: CGFloat = 27
  static let groupLabelTrailingInset: CGFloat = 37
  static let groupMaximumWidth: CGFloat = 172
  static let groupMinimumWidth: CGFloat = 42
  static let itemHeight: CGFloat = 30
  static let itemSpacing: CGFloat = 4
  static let leadingInset: CGFloat = 2
  static let sectionSeparatorFollowingGap: CGFloat = 2
  static let sectionSeparatorWidth: CGFloat = 8
  static let tabLabelLeadingInset: CGFloat = 9
  static let tabLabelTrailingGap: CGFloat = 4
  static let tabLabelTrailingInset: CGFloat =
    tabLabelTrailingGap + closeButtonSize + closeButtonTrailingInset
  static let tabMaximumWidth: CGFloat = 172
  static let tabMinimumWidth: CGFloat = 64
  static let trailingInset: CGFloat = 2

  static func closeButtonFrame(in bounds: CGRect) -> CGRect {
    CGRect(
      x: bounds.maxX - closeButtonTrailingInset - closeButtonSize,
      y: bounds.midY - closeButtonSize / 2,
      width: closeButtonSize,
      height: closeButtonSize
    )
  }

  static var groupTitleHorizontalInset: CGFloat {
    groupLabelLeadingInset + groupLabelTrailingInset
  }

  static var tabTitleHorizontalInset: CGFloat {
    tabLabelLeadingInset + tabLabelTrailingInset
  }
}

struct TerminalHorizontalTabLayout: Equatable {
  enum ItemKind: Equatable {
    case group(
      id: TerminalTabGroupID,
      lane: TerminalSidebarRootLane,
      rootIndex: Int,
      isCollapsed: Bool
    )
    case groupedTab(id: TerminalTabID, groupID: TerminalTabGroupID, index: Int)
    case rootTab(
      id: TerminalTabID,
      lane: TerminalSidebarRootLane,
      rootIndex: Int
    )
  }

  struct Item: Equatable {
    let entryID: TerminalSidebarEntryID
    let frame: CGRect
    let kind: ItemKind
  }

  struct Group: Equatable {
    let id: TerminalTabGroupID
    let frame: CGRect
    let closeButtonFrame: CGRect?
    let isCollapsed: Bool
  }

  let groups: [Group]
  let hiddenEntryIDs: [TerminalSidebarEntryID]
  let items: [Item]
  let newTabFrame: CGRect
  let overflowFrame: CGRect?
  let sectionSeparatorFrame: CGRect?

  init(
    snapshot: TerminalTabSurfaceSnapshot,
    availableWidth: CGFloat,
    titleForEntry: (TerminalSidebarEntryID, String) -> String = { _, title in title },
    measureContent: (TerminalSidebarEntryID, String) -> CGFloat
  ) {
    let candidates = Self.candidates(
      snapshot: snapshot,
      titleForEntry: titleForEntry,
      measureContent: measureContent
    )
    let controlsWidth =
      TerminalHorizontalTabLayoutMetrics.controlWidth
      + TerminalHorizontalTabLayoutMetrics.itemSpacing
      + TerminalHorizontalTabLayoutMetrics.trailingInset
    let initialBudget = max(
      0,
      availableWidth - TerminalHorizontalTabLayoutMetrics.leadingInset - controlsWidth
    )
    let initialWidths = Self.resolvedWidths(candidates, budget: initialBudget)
    let needsOverflow = Self.consumedWidth(candidates, widths: initialWidths) > initialBudget
    let overflowWidth =
      needsOverflow
      ? TerminalHorizontalTabLayoutMetrics.controlWidth
        + TerminalHorizontalTabLayoutMetrics.itemSpacing
      : 0
    let itemBudget = max(0, initialBudget - overflowWidth)
    let visibleCandidates = Self.visibleCandidates(candidates, budget: itemBudget)
    let widths = Self.resolvedWidths(visibleCandidates, budget: itemBudget)

    var x = TerminalHorizontalTabLayoutMetrics.leadingInset
    var items: [Item] = []
    var groupCloseButtonFrames: [TerminalTabGroupID: CGRect] = [:]
    var sectionSeparatorFrame: CGRect?
    for (index, element) in zip(visibleCandidates, widths).enumerated() {
      let (candidate, width) = element
      if index > 0 {
        let previous = visibleCandidates[index - 1]
        if previous.lane == candidate.lane {
          x += TerminalHorizontalTabLayoutMetrics.itemSpacing
        } else {
          let frame = CGRect(
            x: x,
            y: (TerminalHorizontalTabMetrics.height
              - TerminalHorizontalTabLayoutMetrics.itemHeight) / 2,
            width: TerminalHorizontalTabLayoutMetrics.sectionSeparatorWidth,
            height: TerminalHorizontalTabLayoutMetrics.itemHeight
          )
          sectionSeparatorFrame = frame
          x = frame.maxX + TerminalHorizontalTabLayoutMetrics.sectionSeparatorFollowingGap
        }
      }
      switch candidate.content {
      case .item(let entryID, let kind):
        let frame = CGRect(
          x: x,
          y: (TerminalHorizontalTabMetrics.height
            - TerminalHorizontalTabLayoutMetrics.itemHeight) / 2,
          width: width,
          height: TerminalHorizontalTabLayoutMetrics.itemHeight
        )
        items.append(Item(entryID: entryID, frame: frame, kind: kind))
      case .groupClose(let groupID):
        groupCloseButtonFrames[groupID] = CGRect(
          x: x,
          y: (TerminalHorizontalTabMetrics.height
            - TerminalHorizontalTabLayoutMetrics.closeButtonSize) / 2,
          width: width,
          height: TerminalHorizontalTabLayoutMetrics.closeButtonSize
        )
      }
      x += width
    }
    self.items = items
    self.sectionSeparatorFrame = sectionSeparatorFrame
    groups = Self.groups(items: items, closeButtonFrames: groupCloseButtonFrames)
    let visibleEntryIDs = Set(visibleCandidates.compactMap(\.entryID))
    hiddenEntryIDs = candidates.compactMap(\.entryID).filter { !visibleEntryIDs.contains($0) }
    if !items.isEmpty {
      x += TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    if hiddenEntryIDs.isEmpty {
      overflowFrame = nil
    } else {
      overflowFrame = CGRect(
        x: max(x, availableWidth - controlsWidth - overflowWidth),
        y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.controlWidth)
          / 2,
        width: TerminalHorizontalTabLayoutMetrics.controlWidth,
        height: TerminalHorizontalTabLayoutMetrics.controlWidth
      )
      x = overflowFrame!.maxX + TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    newTabFrame = CGRect(
      x: min(x, max(0, availableWidth - TerminalHorizontalTabLayoutMetrics.controlWidth)),
      y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.controlWidth)
        / 2,
      width: TerminalHorizontalTabLayoutMetrics.controlWidth,
      height: TerminalHorizontalTabLayoutMetrics.controlWidth
    )
  }

  func semanticPath(
    at point: CGPoint,
    source: TerminalSidebarDragSource
  ) -> TerminalSidebarSemanticPath? {
    guard point.y >= 0, point.y <= TerminalHorizontalTabMetrics.height else { return nil }
    if newTabFrame.contains(point) || overflowFrame?.contains(point) == true { return nil }
    if sectionSeparatorFrame?.contains(point) == true {
      let index =
        items.compactMap { item -> Int? in
          switch item.kind {
          case .rootTab(_, .pinned, let rootIndex), .group(_, .pinned, let rootIndex, _):
            rootIndex + 1
          case .groupedTab, .rootTab, .group:
            nil
          }
        }.max() ?? 0
      return .rootBoundary(lane: .pinned, index: index)
    }
    if case .group = source,
      let group = groups.first(where: { $0.frame.contains(point) }),
      let header = items.first(where: { $0.entryID == .group(group.id) }),
      case .group(_, let lane, let rootIndex, _) = header.kind
    {
      return .rootBoundary(
        lane: lane,
        index: point.x < header.frame.midX ? rootIndex : rootIndex + 1
      )
    }
    if let item = items.first(where: { $0.frame.contains(point) }) {
      return semanticPath(for: item, x: point.x)
    }
    guard
      point.x >= TerminalHorizontalTabLayoutMetrics.leadingInset,
      point.x < (overflowFrame ?? newTabFrame).minX
    else { return nil }
    let previous = items.last { $0.frame.maxX < point.x }
    let next = items.first { $0.frame.minX > point.x }
    if let previous, let next,
      case .group(let groupID, _, _, _) = previous.kind,
      case .groupedTab(_, let childGroupID, let index) = next.kind,
      groupID == childGroupID
    {
      return .groupBoundary(groupID, index: index)
    }
    if let previous, let next,
      case .groupedTab(_, let groupID, _) = previous.kind,
      case .groupedTab(_, let childGroupID, let index) = next.kind,
      groupID == childGroupID
    {
      return .groupBoundary(groupID, index: index)
    }
    switch (previous, next) {
    case (.some(let previous), .some(let next)):
      let usePrevious = point.x <= (previous.frame.maxX + next.frame.minX) / 2
      let item = usePrevious ? previous : next
      return semanticPath(
        for: item,
        x: usePrevious ? item.frame.maxX : item.frame.minX
      )
    case (.some(let previous), nil):
      return semanticPath(for: previous, x: previous.frame.maxX)
    case (nil, .some(let next)):
      return semanticPath(for: next, x: next.frame.minX)
    case (nil, nil):
      return nil
    }
  }

  private func semanticPath(
    for item: Item,
    x: CGFloat
  ) -> TerminalSidebarSemanticPath {
    let fraction = item.frame.width > 0 ? (x - item.frame.minX) / item.frame.width : 0.5
    switch item.kind {
    case .rootTab(_, let lane, let rootIndex):
      if fraction < 0.5 {
        return .rootBoundary(lane: lane, index: rootIndex)
      }
      return .rootBoundary(lane: lane, index: rootIndex + 1)
    case .group(let id, let lane, let rootIndex, _):
      if fraction < 0.25 {
        return .rootBoundary(lane: lane, index: rootIndex)
      }
      if fraction > 0.75 {
        return .rootBoundary(lane: lane, index: rootIndex + 1)
      }
      return .groupEntry(id)
    case .groupedTab(_, let groupID, let index):
      return .groupBoundary(groupID, index: fraction < 0.5 ? index : index + 1)
    }
  }

  func indicatorFrame(for path: TerminalSidebarSemanticPath) -> CGRect? {
    let x: CGFloat?
    switch path {
    case .rootBoundary(let lane, let index):
      let laneItems = items.compactMap { item -> (Int, CGRect)? in
        switch item.kind {
        case .rootTab(_, let itemLane, let rootIndex):
          guard itemLane == lane else { return nil }
          return (rootIndex, item.frame)
        case .group(let id, let itemLane, let rootIndex, _):
          guard itemLane == lane else { return nil }
          let frame = groups.first { $0.id == id }?.frame ?? item.frame
          return (rootIndex, frame)
        case .groupedTab:
          return nil
        }
      }
      x =
        laneItems.first(where: { $0.0 == index })?.1.minX
        ?? laneItems.last.map { $0.1.maxX }
    case .groupBoundary(let groupID, let index):
      let groupItems = items.compactMap { item -> (Int, CGRect)? in
        guard case .groupedTab(_, let itemGroupID, let itemIndex) = item.kind,
          itemGroupID == groupID
        else { return nil }
        return (itemIndex, item.frame)
      }
      x =
        groupItems.first(where: { $0.0 == index })?.1.minX
        ?? groupItems.last.map { $0.1.maxX }
    case .groupEntry(let groupID):
      x =
        items.first {
          guard case .group(let id, _, _, _) = $0.kind else { return false }
          return id == groupID
        }?.frame.midX
    case .rootItem, .groupItem:
      x = nil
    }
    return x.map {
      CGRect(x: $0 - 1, y: 7, width: 2, height: TerminalHorizontalTabMetrics.height - 14)
    }
  }

  func dragSourceFrame(for entryID: TerminalSidebarEntryID) -> CGRect? {
    switch entryID {
    case .tab:
      items.first { $0.entryID == entryID }?.frame
    case .group(let groupID):
      groups.first { $0.id == groupID }?.frame
    case .pinDivider, .newTab:
      nil
    }
  }

  private enum CandidateContent {
    case item(TerminalSidebarEntryID, ItemKind)
    case groupClose(TerminalTabGroupID)
  }

  private struct Candidate {
    let content: CandidateContent
    let lane: TerminalSidebarRootLane
    let minimumWidth: CGFloat
    let preferredWidth: CGFloat

    var entryID: TerminalSidebarEntryID? {
      guard case .item(let entryID, _) = content else { return nil }
      return entryID
    }
  }

  private static func groups(
    items: [Item],
    closeButtonFrames: [TerminalTabGroupID: CGRect]
  ) -> [Group] {
    items.compactMap { item in
      guard case .group(let id, _, _, let isCollapsed) = item.kind else { return nil }
      let frames = items.compactMap { candidate -> CGRect? in
        switch candidate.kind {
        case .group(let candidateID, _, _, _) where candidateID == id:
          candidate.frame
        case .groupedTab(_, let groupID, _) where groupID == id:
          candidate.frame
        default:
          nil
        }
      }
      guard var frame = frames.reduce(Optional<CGRect>.none, { $0?.union($1) ?? $1 }) else {
        return nil
      }
      if let closeButtonFrame = closeButtonFrames[id] {
        frame = frame.union(closeButtonFrame)
      }
      return Group(
        id: id,
        frame: CGRect(
          x: frame.minX - TerminalHorizontalTabLayoutMetrics.groupSurfaceHorizontalInset,
          y: TerminalHorizontalTabLayoutMetrics.groupSurfaceVerticalInset,
          width: frame.width + TerminalHorizontalTabLayoutMetrics.groupSurfaceHorizontalInset * 2,
          height: TerminalHorizontalTabMetrics.height
            - TerminalHorizontalTabLayoutMetrics.groupSurfaceVerticalInset * 2
        ),
        closeButtonFrame: closeButtonFrames[id],
        isCollapsed: isCollapsed
      )
    }
  }

  private static func candidates(
    snapshot: TerminalTabSurfaceSnapshot,
    titleForEntry: (TerminalSidebarEntryID, String) -> String,
    measureContent: (TerminalSidebarEntryID, String) -> CGFloat
  ) -> [Candidate] {
    var result: [Candidate] = []
    var laneIndices: [TerminalSidebarRootLane: Int] = [:]
    for root in snapshot.collection.rootItems {
      let lane = TerminalSidebarRootLane(isPinned: root.isPinned)
      let rootIndex = laneIndices[lane, default: 0]
      laneIndices[lane] = rootIndex + 1
      switch root {
      case .tab(let item):
        let entryID = TerminalSidebarEntryID.tab(item.tab.id)
        result.append(
          Candidate(
            content: .item(
              entryID,
              .rootTab(id: item.tab.id, lane: lane, rootIndex: rootIndex)
            ),
            lane: lane,
            minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                measureContent(entryID, titleForEntry(entryID, item.tab.title))
                  + TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset
              )
            )
          )
        )
      case .group(let group):
        let isCollapsed = snapshot.collapsedGroupIDs.contains(group.id)
        let entryID = TerminalSidebarEntryID.group(group.id)
        result.append(
          Candidate(
            content: .item(
              entryID,
              .group(
                id: group.id,
                lane: lane,
                rootIndex: rootIndex,
                isCollapsed: isCollapsed
              )
            ),
            lane: lane,
            minimumWidth: TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.groupMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
                measureContent(entryID, titleForEntry(entryID, group.title))
                  + TerminalHorizontalTabLayoutMetrics.groupTitleHorizontalInset
              )
            )
          )
        )
        guard !isCollapsed else { continue }
        for (index, tab) in group.tabs.enumerated() {
          let entryID = TerminalSidebarEntryID.tab(tab.id)
          result.append(
            Candidate(
              content: .item(
                entryID,
                .groupedTab(id: tab.id, groupID: group.id, index: index)
              ),
              lane: lane,
              minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
              preferredWidth: min(
                TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
                max(
                  TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                  measureContent(entryID, titleForEntry(entryID, tab.title))
                    + TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset
                )
              )
            )
          )
        }
        result.append(
          Candidate(
            content: .groupClose(group.id),
            lane: lane,
            minimumWidth: TerminalHorizontalTabLayoutMetrics.closeButtonSize,
            preferredWidth: TerminalHorizontalTabLayoutMetrics.closeButtonSize
          )
        )
      }
    }
    return result
  }

  private static func resolvedWidths(_ candidates: [Candidate], budget: CGFloat) -> [CGFloat] {
    guard !candidates.isEmpty else { return [] }
    let widthBudget = max(0, budget - spacingWidth(candidates))
    var widths = candidates.map(\.preferredWidth)
    var excess = max(0, widths.reduce(0, +) - widthBudget)
    while excess > 0 {
      let flexible = widths.indices.filter { widths[$0] > candidates[$0].minimumWidth }
      guard !flexible.isEmpty else { break }
      let reduction = excess / CGFloat(flexible.count)
      var applied: CGFloat = 0
      for index in flexible {
        let value = min(reduction, widths[index] - candidates[index].minimumWidth)
        widths[index] -= value
        applied += value
      }
      guard applied > 0 else { break }
      excess -= applied
    }
    return widths
  }

  private static func consumedWidth(_ candidates: [Candidate], widths: [CGFloat]) -> CGFloat {
    widths.reduce(0, +) + spacingWidth(candidates)
  }

  private static func visibleCandidates(
    _ candidates: [Candidate],
    budget: CGFloat
  ) -> [Candidate] {
    let minimumWidths = candidates.map(\.minimumWidth)
    guard consumedWidth(candidates, widths: minimumWidths) > budget else {
      return candidates
    }
    var result: [Candidate] = []
    var consumed: CGFloat = 0
    var index = candidates.startIndex
    while candidates.indices.contains(index) {
      let candidate = candidates[index]
      if case .item(_, .group(let groupID, _, _, false)) = candidate.content,
        let closeIndex = candidates[index...].firstIndex(where: {
          guard case .groupClose(let candidateGroupID) = $0.content else { return false }
          return candidateGroupID == groupID
        })
      {
        let close = candidates[closeIndex]
        let headerAddition = addition(candidate, after: result.last)
        let required =
          headerAddition
          + spacing(from: candidate, to: close)
          + close.minimumWidth
        guard consumed + required <= budget else { break }
        result.append(candidate)
        consumed += headerAddition
        var childIndex = candidates.index(after: index)
        while childIndex < closeIndex {
          let child = candidates[childIndex]
          let childRequired =
            addition(child, after: result.last)
            + spacing(from: child, to: close)
            + close.minimumWidth
          guard consumed + childRequired <= budget else {
            result.append(close)
            return result
          }
          consumed += addition(child, after: result.last)
          result.append(child)
          childIndex = candidates.index(after: childIndex)
        }
        consumed += addition(close, after: result.last)
        result.append(close)
        index = candidates.index(after: closeIndex)
        continue
      }
      let addition = addition(candidate, after: result.last)
      guard consumed + addition <= budget else { break }
      result.append(candidate)
      consumed += addition
      index = candidates.index(after: index)
    }
    return result
  }

  private static func addition(_ candidate: Candidate, after previous: Candidate?) -> CGFloat {
    candidate.minimumWidth + (previous.map { spacing(from: $0, to: candidate) } ?? 0)
  }

  private static func spacingWidth(_ candidates: [Candidate]) -> CGFloat {
    guard candidates.count > 1 else { return 0 }
    return candidates.indices.dropFirst().reduce(into: CGFloat.zero) { result, index in
      result += spacing(from: candidates[index - 1], to: candidates[index])
    }
  }

  private static func spacing(from previous: Candidate, to candidate: Candidate) -> CGFloat {
    if previous.lane == candidate.lane {
      return TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    return TerminalHorizontalTabLayoutMetrics.sectionSeparatorWidth
      + TerminalHorizontalTabLayoutMetrics.sectionSeparatorFollowingGap
  }
}
