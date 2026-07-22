import CoreGraphics
import Foundation

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
    TerminalTabGroupColor,
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
    case group(TerminalTabGroupID, color: TerminalTabGroupColor, isPinned: Bool, isCollapsed: Bool)
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

enum TerminalSidebarRootTargetAffinity: Equatable {
  case before
  case after
}

enum TerminalSidebarSemanticPath: Equatable {
  case rootItem(index: Int)
  case rootBoundary(index: Int, affinity: TerminalSidebarRootTargetAffinity)
  case group(TerminalTabGroupID, index: Int)
  case pinnedEnd
  case trailingRoot
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
  let highlightedGroupID: TerminalTabGroupID?

  init(
    path: TerminalSidebarSemanticPath,
    destination: TerminalSidebarDropDestination,
    placeholder: TerminalSidebarDropPlaceholder,
    highlightedGroupID: TerminalTabGroupID? = nil
  ) {
    self.path = path
    self.destination = destination
    self.placeholder = placeholder
    self.highlightedGroupID = highlightedGroupID
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
  let draggingItemIDs: [TerminalSidebarEntryID]
  let target: TerminalSidebarDropPlan?
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

  func matches(_ outline: TerminalSidebarOutline, command: TerminalSidebarDropCommand) -> Bool {
    guard operationID == command.operationID else { return false }
    guard outline.topologyStamp == topologyStamp else { return false }
    guard deletedEmptyGroupIDs.allSatisfy({ outline.group($0) == nil }) else { return false }
    guard command.topologyStamp.spaceID == topologyStamp.spaceID else { return false }
    guard result.itemIDs == command.itemIDs, result.location == command.destination else {
      return false
    }
    switch command.destination {
    case .root(let placement):
      let roots = outline.roots.filter { $0.isPinned == placement.isPinned }.map(\.id)
      let end = placement.index + command.itemIDs.count
      guard placement.index >= 0, end <= roots.count else { return false }
      return Array(roots[placement.index..<end]) == command.itemIDs
    case .group(let groupID, let index):
      let tabIDs = command.itemIDs.compactMap { itemID -> TerminalTabID? in
        guard case .tab(let tabID) = itemID else { return nil }
        return tabID
      }
      guard tabIDs.count == command.itemIDs.count else { return false }
      let children = outline.tabIDs(in: groupID)
      let end = index + tabIDs.count
      guard index >= 0, end <= children.count else { return false }
      return Array(children[index..<end]) == tabIDs
    }
  }
}

enum TerminalSidebarDropPlanner {
  static func plan(
    payload: TerminalSidebarDragPayload,
    path: TerminalSidebarSemanticPath,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard payload.topologyStamp == outline.topologyStamp else { return nil }
    switch path {
    case .rootItem(let index):
      return rootItemPlan(payload: payload, index: index, outline: outline)
    case .rootBoundary(let index, let affinity):
      return rootBoundaryPlan(
        payload: payload,
        index: index,
        affinity: affinity,
        outline: outline
      )
    case .group(let groupID, let index):
      return groupPlan(payload: payload, groupID: groupID, index: index, outline: outline)
    case .pinnedEnd:
      let roots = reducedRoots(payload: payload, outline: outline)
      let firstRegular = roots.first(where: { !$0.isPinned })?.entryID
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: path,
          destination: .root(isPinned: true, index: roots.prefix { $0.isPinned }.count),
          placeholder: firstRegular.map(TerminalSidebarDropPlaceholder.before) ?? .beforeFooter
        ),
        payload: payload,
        outline: outline
      )
    case .trailingRoot:
      let roots = reducedRoots(payload: payload, outline: outline)
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: path,
          destination: .root(isPinned: false, index: roots.count { !$0.isPinned }),
          placeholder: .beforeFooter
        ),
        payload: payload,
        outline: outline
      )
    }
  }

  private static func rootItemPlan(
    payload: TerminalSidebarDragPayload,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard outline.roots.indices.contains(index) else { return nil }
    let target = outline.roots[index]
    if case .tabs(let sourceIDs) = payload.source,
      case .group(let groupID, _, _, let tabIDs) = target.content
    {
      let selected = Set(sourceIDs)
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: .rootItem(index: index),
          destination: .group(groupID, index: tabIDs.count { !selected.contains($0) }),
          placeholder: .groupEnd(groupID),
          highlightedGroupID: groupID
        ),
        payload: payload,
        outline: outline
      )
    }

    return rejectingNoOp(
      rootInsertionPlan(
        payload: payload,
        path: .rootItem(index: index),
        target: target,
        boundary: index,
        outline: outline
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func rootBoundaryPlan(
    payload: TerminalSidebarDragPayload,
    index: Int,
    affinity: TerminalSidebarRootTargetAffinity,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard outline.roots.indices.contains(index) else { return nil }
    let target = outline.roots[index]
    return rejectingNoOp(
      rootInsertionPlan(
        payload: payload,
        path: .rootBoundary(index: index, affinity: affinity),
        target: target,
        boundary: index + (affinity == .after ? 1 : 0),
        outline: outline
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func rootInsertionPlan(
    payload: TerminalSidebarDragPayload,
    path: TerminalSidebarSemanticPath,
    target: TerminalSidebarOutline.Root,
    boundary: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan {
    let reduced = reducedRoots(payload: payload, outline: outline)
    let destinationIndex = outline.roots[..<boundary].count { root in
      root.isPinned == target.isPinned && reduced.contains { $0.id == root.id }
    }
    return TerminalSidebarDropPlan(
      path: path,
      destination: .root(isPinned: target.isPinned, index: destinationIndex),
      placeholder: rootPlaceholder(
        boundary: boundary,
        isPinned: target.isPinned,
        reducedRoots: reduced,
        outline: outline
      )
    )
  }

  private static func groupPlan(
    payload: TerminalSidebarDragPayload,
    groupID: TerminalTabGroupID,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard case .tabs(let sourceIDs) = payload.source else { return nil }
    let original = outline.tabIDs(in: groupID)
    guard (0...original.count).contains(index) else { return nil }
    let selected = Set(sourceIDs)
    let reduced = original.filter { !selected.contains($0) }
    let destinationIndex = original.prefix(index).count { !selected.contains($0) }
    let placeholder =
      reduced.indices.contains(destinationIndex)
      ? TerminalSidebarDropPlaceholder.before(.tab(reduced[destinationIndex]))
      : .groupEnd(groupID)
    return rejectingNoOp(
      TerminalSidebarDropPlan(
        path: .group(groupID, index: index),
        destination: .group(groupID, index: destinationIndex),
        placeholder: placeholder
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func rootPlaceholder(
    boundary: Int,
    isPinned: Bool,
    reducedRoots: [TerminalSidebarOutline.Root],
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlaceholder {
    let survivingIDs = Set(reducedRoots.map(\.id))
    if let next = outline.roots.dropFirst(boundary).first(where: {
      $0.isPinned == isPinned && survivingIDs.contains($0.id)
    }) {
      return .before(next.entryID)
    }
    if isPinned, let firstRegular = reducedRoots.first(where: { !$0.isPinned }) {
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
