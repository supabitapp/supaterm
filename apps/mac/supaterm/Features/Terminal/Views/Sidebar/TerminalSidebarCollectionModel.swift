import CoreGraphics
import Foundation
import SupaTheme

enum TerminalSidebarEntryID: Hashable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)
  case pinDivider
  case newTab
}

enum TerminalSidebarRootContent: Equatable {
  case tab(TerminalTabID)
  case group(
    TerminalTabGroupID,
    ThemeTint,
    TerminalTabGroupLifetime,
    [TerminalTabID]
  )
}

struct TerminalSidebarTopologyStamp: Equatable {
  let spaceID: TerminalSpaceID
  let revision: UInt64
}

struct TerminalSidebarOutline: Equatable {
  struct Root: Equatable {
    let content: TerminalSidebarRootContent
    let isPinned: Bool

    var id: TerminalTabRootItemID {
      switch content {
      case .tab(let id): .tab(id)
      case .group(let id, _, _, _): .group(id)
      }
    }

    var entryID: TerminalSidebarEntryID {
      switch id {
      case .tab(let id): .tab(id)
      case .group(let id): .group(id)
      }
    }
  }

  let roots: [Root]
  let collapsedGroupIDs: Set<TerminalTabGroupID>
  let topologyStamp: TerminalSidebarTopologyStamp?

  init(
    roots: [Root],
    collapsedGroupIDs: Set<TerminalTabGroupID>,
    topologyRevision: UInt64,
    spaceID: TerminalSpaceID? = nil
  ) {
    precondition(spaceID != nil || roots.isEmpty)
    self.roots = roots
    self.collapsedGroupIDs = collapsedGroupIDs
    topologyStamp = spaceID.map {
      TerminalSidebarTopologyStamp(spaceID: $0, revision: topologyRevision)
    }
  }

  init(snapshot: TerminalTabSurfaceSnapshot) {
    roots = snapshot.collection.rootItems.map { root in
      switch root {
      case .tab(let item):
        Root(content: .tab(item.tab.id), isPinned: item.isPinned)
      case .group(let group):
        Root(
          content: .group(group.id, group.color, group.lifetime, group.tabs.map(\.id)),
          isPinned: group.isPinned
        )
      }
    }
    collapsedGroupIDs = snapshot.collapsedGroupIDs
    topologyStamp = TerminalSidebarTopologyStamp(
      spaceID: snapshot.spaceID,
      revision: snapshot.collection.topologyRevision
    )
  }

  var visibleEntries: [TerminalSidebarEntry] {
    var entries: [TerminalSidebarEntry] = []
    let hasPinned = roots.contains { $0.isPinned }
    let hasRegular = roots.contains { !$0.isPinned }

    for (index, root) in roots.enumerated() {
      if hasPinned, hasRegular, index > 0, roots[index - 1].isPinned, !root.isPinned {
        entries.append(TerminalSidebarEntry(kind: .pinDivider))
      }
      switch root.content {
      case .tab(let id):
        entries.append(
          TerminalSidebarEntry(kind: .tab(id, parentGroupID: nil, rootIsPinned: root.isPinned))
        )
      case .group(let id, let color, _, let tabIDs):
        let isCollapsed = collapsedGroupIDs.contains(id)
        entries.append(
          TerminalSidebarEntry(
            kind: .group(id, color: color, isPinned: root.isPinned, isCollapsed: isCollapsed)
          )
        )
        guard !isCollapsed else { continue }
        if !tabIDs.isEmpty {
          entries.append(
            contentsOf: tabIDs.map {
              TerminalSidebarEntry(kind: .tab($0, parentGroupID: id, rootIsPinned: root.isPinned))
            }
          )
        }
      }
    }

    entries.append(TerminalSidebarEntry(kind: .newTab))

    return entries
  }

  func group(_ id: TerminalTabGroupID) -> Root? {
    roots.first {
      if case .group(let groupID, _, _, _) = $0.content { return groupID == id }
      return false
    }
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    guard let root = group(groupID), case .group(_, _, _, let tabIDs) = root.content else {
      return []
    }
    return tabIDs
  }

  func location(of itemID: TerminalTabRootItemID) -> TerminalTabPlacement? {
    for (rootIndex, root) in roots.enumerated() {
      switch (itemID, root.content) {
      case (.tab(let itemID), .tab(let rootID)) where itemID == rootID:
        return .root(rootPlacement(at: rootIndex))
      case (.group(let itemID), .group(let rootID, _, _, _)) where itemID == rootID:
        return .root(rootPlacement(at: rootIndex))
      case (.tab(let itemID), .group(let groupID, _, _, let tabIDs)):
        guard let childIndex = tabIDs.firstIndex(of: itemID) else { continue }
        return .group(groupID, index: childIndex)
      default:
        continue
      }
    }
    return nil
  }

  func dragPayload(
    for entryID: TerminalSidebarEntryID,
    selectedTabIDs: [TerminalTabID] = []
  ) -> TerminalSidebarDragPayload? {
    guard let topologyStamp else { return nil }
    let source: TerminalSidebarDragSource
    switch entryID {
    case .tab(let id):
      let tabIDs = selectedTabIDs.contains(id) ? selectedTabIDs : [id]
      guard !tabIDs.isEmpty, Set(tabIDs).count == tabIDs.count else { return nil }
      source = .tabs(tabIDs)
    case .group(let id):
      source = .group(id)
    case .pinDivider, .newTab:
      return nil
    }
    return TerminalSidebarDragPayload(
      operationID: TerminalTabMoveOperationID(),
      source: source,
      topologyStamp: topologyStamp
    )
  }

  func liftedEntryIDs(for source: TerminalSidebarDragSource) -> [TerminalSidebarEntryID] {
    switch source {
    case .tabs(let ids):
      return ids.map(TerminalSidebarEntryID.tab)
    case .group(let id):
      let visibleIDs = Set(visibleEntryIDs(forGroup: id))
      return visibleEntries.map(\.id).filter { visibleIDs.contains($0) }
    }
  }

  private func rootPlacement(at rootIndex: Int) -> TerminalRootPlacement {
    let root = roots[rootIndex]
    return TerminalRootPlacement(
      isPinned: root.isPinned,
      index: roots[..<rootIndex].count { $0.isPinned == root.isPinned }
    )
  }

  private func visibleEntryIDs(forGroup id: TerminalTabGroupID) -> [TerminalSidebarEntryID] {
    guard let root = group(id), case .group(_, _, _, let tabIDs) = root.content else { return [] }
    var ids: [TerminalSidebarEntryID] = [.group(id)]
    guard !collapsedGroupIDs.contains(id) else { return ids }
    if !tabIDs.isEmpty {
      ids.append(contentsOf: tabIDs.map(TerminalSidebarEntryID.tab))
    }
    return ids
  }
}

struct TerminalSidebarEntry: Equatable {
  enum Kind: Equatable {
    case tab(TerminalTabID, parentGroupID: TerminalTabGroupID?, rootIsPinned: Bool)
    case group(TerminalTabGroupID, color: ThemeTint, isPinned: Bool, isCollapsed: Bool)
    case pinDivider
    case newTab
  }

  let kind: Kind

  var id: TerminalSidebarEntryID {
    switch kind {
    case .tab(let id, _, _): .tab(id)
    case .group(let id, _, _, _): .group(id)
    case .pinDivider: .pinDivider
    case .newTab: .newTab
    }
  }

  var parentGroupID: TerminalTabGroupID? {
    switch kind {
    case .tab(_, let groupID, _): groupID
    case .group, .pinDivider, .newTab: nil
    }
  }
}

enum TerminalSidebarDragSource: Equatable {
  case tabs([TerminalTabID])
  case group(TerminalTabGroupID)

  var itemIDs: [TerminalTabRootItemID] {
    switch self {
    case .tabs(let ids): ids.map(TerminalTabRootItemID.tab)
    case .group(let id): [.group(id)]
    }
  }
}

struct TerminalSidebarDragPayload: Equatable {
  let operationID: TerminalTabMoveOperationID
  let source: TerminalSidebarDragSource
  let topologyStamp: TerminalSidebarTopologyStamp

  var topologyRevision: UInt64 {
    topologyStamp.revision
  }
}

enum TerminalSidebarRootLane: Hashable {
  case pinned
  case regular

  init(isPinned: Bool) {
    self = isPinned ? .pinned : .regular
  }

  var isPinned: Bool {
    self == .pinned
  }
}

enum TerminalSidebarSemanticPath: Hashable {
  case rootItem(lane: TerminalSidebarRootLane, index: Int, id: TerminalTabRootItemID)
  case rootBoundary(lane: TerminalSidebarRootLane, index: Int)
  case groupEntry(TerminalTabGroupID)
  case groupItem(TerminalTabGroupID, index: Int, id: TerminalTabID)
  case groupBoundary(TerminalTabGroupID, index: Int)
}

struct TerminalSidebarSemanticTarget: Equatable {
  let path: TerminalSidebarSemanticPath
  let frame: CGRect
}

enum TerminalSidebarDropDestination: Equatable {
  case root(isPinned: Bool, index: Int)
  case group(TerminalTabGroupID, index: Int)
}

enum TerminalSidebarDropPlaceholder: Equatable {
  case before(TerminalSidebarEntryID)
  case beforeFooter
  case groupEnd(TerminalTabGroupID)
}

struct TerminalSidebarDropPlan: Equatable {
  let path: TerminalSidebarSemanticPath
  let destination: TerminalSidebarDropDestination
  let placeholder: TerminalSidebarDropPlaceholder

  init(
    path: TerminalSidebarSemanticPath,
    destination: TerminalSidebarDropDestination,
    placeholder: TerminalSidebarDropPlaceholder
  ) {
    self.path = path
    self.destination = destination
    self.placeholder = placeholder
  }

  var destinationGroupID: TerminalTabGroupID? {
    guard case .group(let groupID, _) = destination else { return nil }
    return groupID
  }

  var highlightedGroupID: TerminalTabGroupID? {
    guard case .groupEntry(let groupID) = path else { return nil }
    return groupID
  }

  func command(for payload: TerminalSidebarDragPayload) -> TerminalSidebarDropCommand? {
    switch destination {
    case .root(let isPinned, let index):
      return TerminalSidebarDropCommand(
        operationID: payload.operationID,
        topologyStamp: payload.topologyStamp,
        itemIDs: payload.source.itemIDs,
        destination: .root(TerminalRootPlacement(isPinned: isPinned, index: index))
      )
    case .group(let groupID, let index):
      guard case .tabs = payload.source else { return nil }
      return TerminalSidebarDropCommand(
        operationID: payload.operationID,
        topologyStamp: payload.topologyStamp,
        itemIDs: payload.source.itemIDs,
        destination: .group(groupID, index: index)
      )
    }
  }
}

struct TerminalSidebarDragDropState: Equatable {
  let source: TerminalSidebarDragSource
  let draggingItemIDs: [TerminalSidebarEntryID]
  let target: TerminalSidebarDropPlan?
  let dropGapHeight: CGFloat?

  init(
    source: TerminalSidebarDragSource,
    draggingItemIDs: [TerminalSidebarEntryID],
    target: TerminalSidebarDropPlan?,
    dropGapHeight: CGFloat? = nil
  ) {
    self.source = source
    self.draggingItemIDs = draggingItemIDs
    self.target = target
    self.dropGapHeight = dropGapHeight
  }
}

struct TerminalSidebarDropResolution: Equatable {
  let path: TerminalSidebarSemanticPath?
  let plan: TerminalSidebarDropPlan?

  init(
    payload: TerminalSidebarDragPayload,
    path: TerminalSidebarSemanticPath?,
    outline: TerminalSidebarOutline
  ) {
    self.path = path
    plan = path.flatMap {
      TerminalSidebarDropPlanner.plan(payload: payload, path: $0, outline: outline)
    }
  }
}

struct TerminalSidebarDropCommand: Equatable {
  let operationID: TerminalTabMoveOperationID
  let topologyStamp: TerminalSidebarTopologyStamp
  let itemIDs: [TerminalTabRootItemID]
  let destination: TerminalTabPlacement
}

struct TerminalSidebarDropReceipt: Equatable {
  let spaceID: TerminalSpaceID
  let result: TerminalTabMoveResult

  var operationID: TerminalTabMoveOperationID { result.operationID }

  var topologyStamp: TerminalSidebarTopologyStamp {
    TerminalSidebarTopologyStamp(spaceID: spaceID, revision: result.topologyRevision)
  }

  var topologyRevision: UInt64 { topologyStamp.revision }

  var deletedEmptyGroupIDs: [TerminalTabGroupID] { result.deletedEmptyGroupIDs }
}

enum TerminalSidebarDropPlanner {
  static func plan(
    payload: TerminalSidebarDragPayload,
    path: TerminalSidebarSemanticPath,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard payload.topologyStamp == outline.topologyStamp else { return nil }
    switch path {
    case .rootItem(let lane, let index, let id):
      return rootItemPlan(
        payload: payload,
        lane: lane,
        index: index,
        id: id,
        outline: outline
      )
    case .rootBoundary(let lane, let index):
      return rootBoundaryPlan(payload: payload, lane: lane, index: index, outline: outline)
    case .groupEntry(let groupID):
      return groupEntryPlan(payload: payload, groupID: groupID, outline: outline)
    case .groupItem(let groupID, let index, let id):
      return groupItemPlan(
        payload: payload,
        groupID: groupID,
        index: index,
        id: id,
        outline: outline
      )
    case .groupBoundary(let groupID, let index):
      return groupBoundaryPlan(
        payload: payload,
        groupID: groupID,
        index: index,
        outline: outline
      )
    }
  }

  private static func rootItemPlan(
    payload: TerminalSidebarDragPayload,
    lane: TerminalSidebarRootLane,
    index: Int,
    id: TerminalTabRootItemID,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    let original = outline.roots.filter { $0.isPinned == lane.isPinned }
    guard original.indices.contains(index), original[index].id == id else { return nil }
    guard !payload.source.itemIDs.contains(id) else { return nil }
    let path = TerminalSidebarSemanticPath.rootItem(lane: lane, index: index, id: id)

    if case .tabs = payload.source, case .group = original[index].content {
      return nil
    }

    let reduced = reducedRoots(payload: payload, outline: outline)
    let reducedLane = reduced.filter { $0.isPinned == lane.isPinned }
    guard let candidateIndex = reducedLane.firstIndex(where: { $0.id == id }) else {
      return nil
    }
    guard
      let insertionOffset = itemCandidateInsertionOffset(
        payload: payload,
        candidateID: original[index].entryID,
        outline: outline
      )
    else { return nil }
    let destinationIndex = candidateIndex + insertionOffset
    return rejectingNoOp(
      TerminalSidebarDropPlan(
        path: path,
        destination: .root(isPinned: lane.isPinned, index: destinationIndex),
        placeholder: rootPlaceholder(
          lane: lane,
          index: destinationIndex,
          reducedRoots: reduced
        )
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func rootBoundaryPlan(
    payload: TerminalSidebarDragPayload,
    lane: TerminalSidebarRootLane,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    let original = outline.roots.filter { $0.isPinned == lane.isPinned }
    guard (0...original.count).contains(index) else { return nil }
    let reduced = reducedRoots(payload: payload, outline: outline)
    let reducedLane = reduced.filter { $0.isPinned == lane.isPinned }
    let survivingIDs = Set(reducedLane.map(\.id))
    let destinationIndex = original.prefix(index).count { survivingIDs.contains($0.id) }
    return rejectingNoOp(
      TerminalSidebarDropPlan(
        path: .rootBoundary(lane: lane, index: index),
        destination: .root(isPinned: lane.isPinned, index: destinationIndex),
        placeholder: rootPlaceholder(
          lane: lane,
          index: destinationIndex,
          reducedRoots: reduced
        )
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func groupEntryPlan(
    payload: TerminalSidebarDragPayload,
    groupID: TerminalTabGroupID,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard outline.group(groupID) != nil else { return nil }
    return groupPlan(
      payload: payload,
      path: .groupEntry(groupID),
      groupID: groupID,
      destinationIndex: 0,
      outline: outline
    )
  }

  private static func groupItemPlan(
    payload: TerminalSidebarDragPayload,
    groupID: TerminalTabGroupID,
    index: Int,
    id: TerminalTabID,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard case .tabs(let sourceIDs) = payload.source else { return nil }
    let original = outline.tabIDs(in: groupID)
    guard original.indices.contains(index), original[index] == id else { return nil }
    guard !sourceIDs.contains(id) else { return nil }
    let reduced = original.filter { !sourceIDs.contains($0) }
    guard let candidateIndex = reduced.firstIndex(of: id) else { return nil }
    guard
      let insertionOffset = itemCandidateInsertionOffset(
        payload: payload,
        candidateID: .tab(id),
        outline: outline
      )
    else { return nil }
    return groupPlan(
      payload: payload,
      path: .groupItem(groupID, index: index, id: id),
      groupID: groupID,
      destinationIndex: candidateIndex + insertionOffset,
      outline: outline
    )
  }

  private static func itemCandidateInsertionOffset(
    payload: TerminalSidebarDragPayload,
    candidateID: TerminalSidebarEntryID,
    outline: TerminalSidebarOutline
  ) -> Int? {
    let visibleIDs = outline.visibleEntries.map(\.id)
    guard let candidateIndex = visibleIDs.firstIndex(of: candidateID) else { return nil }
    let sourceIDs = payload.source.itemIDs.map { itemID in
      switch itemID {
      case .tab(let tabID): TerminalSidebarEntryID.tab(tabID)
      case .group(let groupID): TerminalSidebarEntryID.group(groupID)
      }
    }
    let sourceIndices = sourceIDs.compactMap { visibleIDs.firstIndex(of: $0) }
    guard !sourceIndices.isEmpty else { return 0 }
    guard sourceIndices.count == sourceIDs.count else { return nil }
    if sourceIndices.allSatisfy({ $0 < candidateIndex }) { return 1 }
    if sourceIndices.allSatisfy({ $0 > candidateIndex }) { return 0 }
    return nil
  }

  private static func groupBoundaryPlan(
    payload: TerminalSidebarDragPayload,
    groupID: TerminalTabGroupID,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard case .tabs(let sourceIDs) = payload.source else { return nil }
    guard outline.group(groupID) != nil else { return nil }
    let original = outline.tabIDs(in: groupID)
    guard (0...original.count).contains(index) else { return nil }
    let selected = Set(sourceIDs)
    let destinationIndex = original.prefix(index).count { !selected.contains($0) }
    return groupPlan(
      payload: payload,
      path: .groupBoundary(groupID, index: index),
      groupID: groupID,
      destinationIndex: destinationIndex,
      outline: outline
    )
  }

  private static func groupPlan(
    payload: TerminalSidebarDragPayload,
    path: TerminalSidebarSemanticPath,
    groupID: TerminalTabGroupID,
    destinationIndex: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard case .tabs(let sourceIDs) = payload.source else { return nil }
    guard outline.group(groupID) != nil else { return nil }
    let selected = Set(sourceIDs)
    let reduced = outline.tabIDs(in: groupID).filter { !selected.contains($0) }
    guard (0...reduced.count).contains(destinationIndex) else { return nil }
    let placeholder =
      reduced.indices.contains(destinationIndex)
      ? TerminalSidebarDropPlaceholder.before(.tab(reduced[destinationIndex]))
      : .groupEnd(groupID)
    return rejectingNoOp(
      TerminalSidebarDropPlan(
        path: path,
        destination: .group(groupID, index: destinationIndex),
        placeholder: placeholder
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func rootPlaceholder(
    lane: TerminalSidebarRootLane,
    index: Int,
    reducedRoots: [TerminalSidebarOutline.Root]
  ) -> TerminalSidebarDropPlaceholder {
    let reducedLane = reducedRoots.filter { $0.isPinned == lane.isPinned }
    if reducedLane.indices.contains(index) {
      return .before(reducedLane[index].entryID)
    }
    if lane == .pinned, let firstRegular = reducedRoots.first(where: { !$0.isPinned }) {
      return .before(firstRegular.entryID)
    }
    return .beforeFooter
  }

  private static func reducedRoots(
    payload: TerminalSidebarDragPayload,
    outline: TerminalSidebarOutline
  ) -> [TerminalSidebarOutline.Root] {
    switch payload.source {
    case .group(let sourceID):
      return outline.roots.filter { $0.id != .group(sourceID) }
    case .tabs(let sourceIDs):
      let selected = Set(sourceIDs)
      return outline.roots.compactMap { root in
        switch root.content {
        case .tab(let id):
          return selected.contains(id) ? nil : root
        case .group(let id, let color, let lifetime, let tabIDs):
          guard tabIDs.contains(where: selected.contains) else { return root }
          let children = tabIDs.filter { !selected.contains($0) }
          guard lifetime == .durable || !children.isEmpty else { return nil }
          return TerminalSidebarOutline.Root(
            content: .group(id, color, lifetime, children),
            isPinned: root.isPinned
          )
        }
      }
    }
  }

  private static func rejectingNoOp(
    _ plan: TerminalSidebarDropPlan,
    payload: TerminalSidebarDragPayload,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    isNoOp(payload: payload, destination: plan.destination, outline: outline) ? nil : plan
  }

  private static func isNoOp(
    payload: TerminalSidebarDragPayload,
    destination: TerminalSidebarDropDestination,
    outline: TerminalSidebarOutline
  ) -> Bool {
    let itemIDs = payload.source.itemIDs
    switch destination {
    case .root(let isPinned, let index):
      guard
        itemIDs.allSatisfy({ itemID in
          guard case .root(let placement) = outline.location(of: itemID) else { return false }
          return placement.isPinned == isPinned
        })
      else { return false }
      let current = outline.roots.filter { $0.isPinned == isPinned }.map(\.id)
      var result = current.filter { !itemIDs.contains($0) }
      guard (0...result.count).contains(index) else { return false }
      result.insert(contentsOf: itemIDs, at: index)
      return result == current
    case .group(let groupID, let index):
      let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
        guard case .tab(let tabID) = itemID else { return nil }
        return tabID
      }
      guard tabIDs.count == itemIDs.count else { return false }
      guard
        tabIDs.allSatisfy({ tabID in
          if case .group(let currentGroupID, _) = outline.location(of: .tab(tabID)) {
            return currentGroupID == groupID
          }
          return false
        })
      else { return false }
      let current = outline.tabIDs(in: groupID)
      var result = current.filter { !tabIDs.contains($0) }
      guard (0...result.count).contains(index) else { return false }
      result.insert(contentsOf: tabIDs, at: index)
      return result == current
    }
  }
}
