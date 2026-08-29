import CoreGraphics

enum TerminalHorizontalTabLayoutMetrics {
  static let controlWidth: CGFloat = 28
  static let groupMaximumWidth: CGFloat = 128
  static let groupMinimumWidth: CGFloat = 56
  static let itemHeight: CGFloat = 30
  static let itemSpacing: CGFloat = 4
  static let leadingInset: CGFloat = 2
  static let tabMaximumWidth: CGFloat = 172
  static let tabMinimumWidth: CGFloat = 64
  static let titleHorizontalInset: CGFloat = 34
  static let trailingInset: CGFloat = 2
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

  let hiddenEntryIDs: [TerminalSidebarEntryID]
  let items: [Item]
  let newTabFrame: CGRect
  let overflowFrame: CGRect?

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
    let needsOverflow = Self.consumedWidth(initialWidths) > initialBudget
    let overflowWidth =
      needsOverflow
      ? TerminalHorizontalTabLayoutMetrics.controlWidth
        + TerminalHorizontalTabLayoutMetrics.itemSpacing
      : 0
    let itemBudget = max(0, initialBudget - overflowWidth)
    let visibleIndices = Self.visibleIndices(
      candidates,
      budget: itemBudget,
      selectedTabID: snapshot.collection.selectedTabID
    )
    let visibleCandidates = visibleIndices.map { candidates[$0] }
    let widths = Self.resolvedWidths(visibleCandidates, budget: itemBudget)

    var x = TerminalHorizontalTabLayoutMetrics.leadingInset
    var items: [Item] = []
    for (candidate, width) in zip(visibleCandidates, widths) {
      let frame = CGRect(
        x: x,
        y: (TerminalHorizontalTabMetrics.height - TerminalHorizontalTabLayoutMetrics.itemHeight) / 2,
        width: width,
        height: TerminalHorizontalTabLayoutMetrics.itemHeight
      )
      items.append(Item(entryID: candidate.entryID, frame: frame, kind: candidate.kind))
      x = frame.maxX + TerminalHorizontalTabLayoutMetrics.itemSpacing
    }
    self.items = items
    let visibleSet = Set(visibleIndices)
    hiddenEntryIDs = candidates.indices.compactMap {
      visibleSet.contains($0) ? nil : candidates[$0].entryID
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

  private struct Candidate {
    let entryID: TerminalSidebarEntryID
    let kind: ItemKind
    let minimumWidth: CGFloat
    let preferredWidth: CGFloat
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
            minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                measureTitle(item.tab.title)
                  + TerminalHorizontalTabLayoutMetrics.titleHorizontalInset
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
            minimumWidth: TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
            preferredWidth: min(
              TerminalHorizontalTabLayoutMetrics.groupMaximumWidth,
              max(
                TerminalHorizontalTabLayoutMetrics.groupMinimumWidth,
                measureTitle(group.title) + 28
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
              minimumWidth: TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
              preferredWidth: min(
                TerminalHorizontalTabLayoutMetrics.tabMaximumWidth,
                max(
                  TerminalHorizontalTabLayoutMetrics.tabMinimumWidth,
                  measureTitle(tab.title) + TerminalHorizontalTabLayoutMetrics.titleHorizontalInset
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
    let spacing =
      CGFloat(max(0, candidates.count - 1))
      * TerminalHorizontalTabLayoutMetrics.itemSpacing
    let widthBudget = max(0, budget - spacing)
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

  private static func consumedWidth(_ widths: [CGFloat]) -> CGFloat {
    widths.reduce(0, +)
      + CGFloat(max(0, widths.count - 1)) * TerminalHorizontalTabLayoutMetrics.itemSpacing
  }

  private static func visibleIndices(
    _ candidates: [Candidate],
    budget: CGFloat,
    selectedTabID: TerminalTabID?
  ) -> [Int] {
    let minimumWidths = candidates.map(\.minimumWidth)
    guard consumedWidth(minimumWidths) > budget else { return Array(candidates.indices) }
    var result: [Int] = []
    var consumed: CGFloat = 0
    for index in candidates.indices {
      let addition =
        candidates[index].minimumWidth
        + (result.isEmpty ? 0 : TerminalHorizontalTabLayoutMetrics.itemSpacing)
      guard consumed + addition <= budget else { break }
      result.append(index)
      consumed += addition
    }
    let selectedIndex = candidates.firstIndex {
      guard let selectedTabID else { return false }
      return $0.entryID == .tab(selectedTabID)
    }
    guard let selectedIndex, !result.contains(selectedIndex) else { return result }
    var required = [selectedIndex]
    if case .groupedTab(_, let groupID, _) = candidates[selectedIndex].kind,
      let groupIndex = candidates.firstIndex(where: {
        guard case .group(let id, _, _, _) = $0.kind else { return false }
        return id == groupID
      })
    {
      required.insert(groupIndex, at: 0)
    }
    if consumedWidth(required.map { candidates[$0].minimumWidth }) > budget {
      required = [selectedIndex]
    }
    result.removeAll { required.contains($0) }
    while !result.isEmpty,
      consumedWidth((result + required).map { candidates[$0].minimumWidth }) > budget
    {
      result.removeLast()
    }
    guard consumedWidth(required.map { candidates[$0].minimumWidth }) <= budget else { return [] }
    return Array(Set(result + required)).sorted()
  }
}
