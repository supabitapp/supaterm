import CoreGraphics

enum TerminalHorizontalTabLayoutMetrics {
  static let closeButtonSize: CGFloat = 22
  static let closeButtonTrailingInset: CGFloat = 6
  static let controlWidth: CGFloat = 32
  static let groupSurfaceHorizontalInset: CGFloat = 2
  static let groupSurfaceVerticalInset: CGFloat = 2
  static let groupLabelLeadingInset: CGFloat = 23
  static let groupLabelTrailingInset: CGFloat = 7
  static let groupMaximumWidth: CGFloat = 128
  static let groupMinimumWidth: CGFloat = 56
  static let itemHeight: CGFloat = 30
  static let itemSpacing: CGFloat = 4
  static let leadingInset: CGFloat = 2
  static let sectionSeparatorFollowingGap: CGFloat = 2
  static let sectionSeparatorWidth: CGFloat = 8
  static let tabLabelLeadingInset: CGFloat = 9
  static let tabLabelTrailingInset: CGFloat = closeButtonSize + closeButtonTrailingInset
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
    measureTitle: (String) -> CGFloat
  ) {
    let candidates = Self.candidates(snapshot: snapshot, measureTitle: measureTitle)
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
    let visibleCount = Self.visiblePrefixCount(candidates, budget: itemBudget)
    let visibleCandidates = Array(candidates.prefix(visibleCount))
    let widths = Self.resolvedWidths(visibleCandidates, budget: itemBudget)

    var x = TerminalHorizontalTabLayoutMetrics.leadingInset
    var items: [Item] = []
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
      let frame = CGRect(
        x: x,
        y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.itemHeight) / 2,
        width: width,
        height: TerminalHorizontalTabLayoutMetrics.itemHeight
      )
      items.append(Item(entryID: candidate.entryID, frame: frame, kind: candidate.kind))
      x = frame.maxX
    }
    self.items = items
    self.sectionSeparatorFrame = sectionSeparatorFrame
    groups = Self.groups(items: items)
    hiddenEntryIDs = candidates.dropFirst(visibleCount).map(\.entryID)
    if !items.isEmpty {
      x += TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    if hiddenEntryIDs.isEmpty {
      overflowFrame = nil
    } else {
      overflowFrame = CGRect(
        x: max(x, availableWidth - controlsWidth - overflowWidth),
        y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.controlWidth) / 2,
        width: TerminalHorizontalTabLayoutMetrics.controlWidth,
        height: TerminalHorizontalTabLayoutMetrics.controlWidth
      )
      x = overflowFrame!.maxX + TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    newTabFrame = CGRect(
      x: min(x, max(0, availableWidth - TerminalHorizontalTabLayoutMetrics.controlWidth)),
      y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.controlWidth) / 2,
      width: TerminalHorizontalTabLayoutMetrics.controlWidth,
      height: TerminalHorizontalTabLayoutMetrics.controlWidth
    )
  }

  func semanticPath(at point: CGPoint) -> TerminalSidebarSemanticPath? {
    if sectionSeparatorFrame?.contains(point) == true {
      let index = items.compactMap { item -> Int? in
        switch item.kind {
        case .rootTab(_, .pinned, let rootIndex), .group(_, .pinned, let rootIndex, _):
          rootIndex + 1
        case .groupedTab, .rootTab, .group:
          nil
        }
      }.max() ?? 0
      return .rootBoundary(lane: .pinned, index: index)
    }
    guard let item = items.first(where: { $0.frame.contains(point) }) else { return nil }
    let fraction = item.frame.width > 0 ? (point.x - item.frame.minX) / item.frame.width : 0.5
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
        case .group(_, let itemLane, let rootIndex, _):
          guard itemLane == lane else { return nil }
          return (rootIndex, item.frame)
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

  private struct Candidate {
    let entryID: TerminalSidebarEntryID
    let kind: ItemKind
    let lane: TerminalSidebarRootLane
    let minimumWidth: CGFloat
    let preferredWidth: CGFloat
  }

  private static func groups(items: [Item]) -> [Group] {
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
      guard let frame = frames.reduce(Optional<CGRect>.none, { $0?.union($1) ?? $1 }) else {
        return nil
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
        isCollapsed: isCollapsed
      )
    }
  }

  private static func candidates(
    snapshot: TerminalTabSurfaceSnapshot,
    measureTitle: (String) -> CGFloat
  ) -> [Candidate] {
    var result: [Candidate] = []
    var laneIndices: [TerminalSidebarRootLane: Int] = [:]
    for root in snapshot.collection.rootItems {
      let lane = TerminalSidebarRootLane(isPinned: root.isPinned)
      let rootIndex = laneIndices[lane, default: 0]
      laneIndices[lane] = rootIndex + 1
      switch root {
      case .tab(let item):
        result.append(
          Candidate(
            entryID: .tab(item.tab.id),
            kind: .rootTab(id: item.tab.id, lane: lane, rootIndex: rootIndex),
            lane: lane,
            minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                measureTitle(item.tab.title)
                  + TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset
              )
            )
          )
        )
      case .group(let group):
        let isCollapsed = snapshot.collapsedGroupIDs.contains(group.id)
        result.append(
          Candidate(
            entryID: .group(group.id),
            kind: .group(
              id: group.id,
              lane: lane,
              rootIndex: rootIndex,
              isCollapsed: isCollapsed
            ),
            lane: lane,
            minimumWidth: TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.groupMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
                measureTitle(group.title)
                  + TerminalHorizontalTabLayoutMetrics.groupTitleHorizontalInset
              )
            )
          )
        )
        guard !isCollapsed else { continue }
        for (index, tab) in group.tabs.enumerated() {
          result.append(
            Candidate(
              entryID: .tab(tab.id),
              kind: .groupedTab(id: tab.id, groupID: group.id, index: index),
              lane: lane,
              minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
              preferredWidth: min(
                TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
                max(
                  TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                  measureTitle(tab.title)
                    + TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset
                )
              )
            )
          )
        }
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

  private static func visiblePrefixCount(_ candidates: [Candidate], budget: CGFloat) -> Int {
    let minimumWidths = candidates.map(\.minimumWidth)
    guard consumedWidth(candidates, widths: minimumWidths) > budget else {
      return candidates.count
    }
    var count = 0
    var consumed: CGFloat = 0
    for index in candidates.indices {
      let addition =
        candidates[index].minimumWidth
        + (index == candidates.startIndex
          ? 0
          : spacing(from: candidates[index - 1], to: candidates[index]))
      guard consumed + addition <= budget else { break }
      count += 1
      consumed += addition
    }
    return count
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
