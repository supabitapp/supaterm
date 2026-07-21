import CoreGraphics
import Foundation

enum TerminalSidebarEntryID: Hashable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)
  case pinDivider
  case newTab
  case newGroup
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

  var topologyRevision: UInt64 {
    topologyStamp?.revision ?? 0
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
    entries.append(TerminalSidebarEntry(kind: .newGroup))
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

  func dragPayload(for entryID: TerminalSidebarEntryID) -> TerminalSidebarDragPayload? {
    guard let topologyStamp else { return nil }
    let value: TerminalSidebarDragValue
    let itemIDs: [TerminalTabRootItemID]
    let entryIDs: [TerminalSidebarEntryID]
    switch entryID {
    case .tab(let id):
      value = .tab(id)
      itemIDs = [.tab(id)]
      entryIDs = [.tab(id)]
    case .group(let id):
      value = .group(id)
      itemIDs = [.group(id)]
      let visibleIDs = Set(visibleEntryIDs(forGroup: id))
      entryIDs = visibleEntries.map(\.id).filter { visibleIDs.contains($0) }
    case .pinDivider, .newTab, .newGroup:
      return nil
    }
    return TerminalSidebarDragPayload(
      operationID: TerminalTabMoveOperationID(),
      value: value,
      itemIDs: itemIDs,
      entryIDs: entryIDs,
      topologyStamp: topologyStamp
    )
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
    case newGroup
  }

  let kind: Kind

  var id: TerminalSidebarEntryID {
    switch kind {
    case .tab(let id, _, _): .tab(id)
    case .group(let id, _, _, _): .group(id)
    case .pinDivider: .pinDivider
    case .newTab: .newTab
    case .newGroup: .newGroup
    }
  }

  var parentGroupID: TerminalTabGroupID? {
    switch kind {
    case .tab(_, let groupID, _): groupID
    case .group, .pinDivider, .newTab, .newGroup: nil
    }
  }
}

enum TerminalSidebarDragValue: Equatable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)
}

struct TerminalSidebarDragPayload: Equatable {
  let operationID: TerminalTabMoveOperationID
  let value: TerminalSidebarDragValue
  let itemIDs: [TerminalTabRootItemID]
  let entryIDs: [TerminalSidebarEntryID]
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
  case root(index: Int, affinity: TerminalSidebarRootTargetAffinity)
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
  case createGroup(targetTabID: TerminalTabID)
}

enum TerminalSidebarDropPlaceholder: Equatable {
  case before(TerminalSidebarEntryID)
  case beforeFooter
  case groupEnd(TerminalTabGroupID)
  case groupHighlight(TerminalTabGroupID)
  case tabHighlight(TerminalTabID)
}

struct TerminalSidebarDropPlan: Equatable {
  let path: TerminalSidebarSemanticPath
  let destination: TerminalSidebarDropDestination
  let placeholder: TerminalSidebarDropPlaceholder
}

struct TerminalSidebarDragDropState: Equatable {
  let draggingItemIDs: [TerminalSidebarEntryID]
  let target: TerminalSidebarDropPlan?
}

struct TerminalSidebarDropTransaction: Equatable {
  let payload: TerminalSidebarDragPayload
  let plan: TerminalSidebarDropPlan
}

enum TerminalSidebarDropReceipt: Equatable {
  case moved(spaceID: TerminalSpaceID, result: TerminalTabMoveResult)
  case createdGroup(
    operationID: TerminalTabMoveOperationID,
    spaceID: TerminalSpaceID,
    result: TerminalTabGroupCreationResult
  )

  var operationID: TerminalTabMoveOperationID {
    switch self {
    case .moved(_, let result): result.operationID
    case .createdGroup(let operationID, _, _): operationID
    }
  }

  var topologyStamp: TerminalSidebarTopologyStamp {
    switch self {
    case .moved(let spaceID, let result):
      TerminalSidebarTopologyStamp(spaceID: spaceID, revision: result.topologyRevision)
    case .createdGroup(_, let spaceID, let result):
      TerminalSidebarTopologyStamp(spaceID: spaceID, revision: result.topologyRevision)
    }
  }

  var topologyRevision: UInt64 { topologyStamp.revision }

  var createdGroupID: TerminalTabGroupID? {
    guard case .createdGroup(_, _, let result) = self else { return nil }
    return result.groupID
  }

  var deletedEmptyGroupIDs: [TerminalTabGroupID] {
    switch self {
    case .moved(_, let result): result.deletedEmptyGroupIDs
    case .createdGroup(_, _, let result): result.deletedEmptyGroupIDs
    }
  }

  func matches(_ outline: TerminalSidebarOutline) -> Bool {
    guard outline.topologyStamp == topologyStamp else { return false }
    guard deletedEmptyGroupIDs.allSatisfy({ outline.group($0) == nil }) else { return false }
    switch self {
    case .moved(_, let result):
      guard let firstItemID = result.itemIDs.first else { return false }
      guard result.itemIDs.allSatisfy({ outline.location(of: $0) != nil }) else { return false }
      return outline.location(of: firstItemID) == result.location
    case .createdGroup(_, _, let result):
      return outline.group(result.groupID) != nil
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
    case .root(let index, let affinity):
      return rootPlan(payload: payload, index: index, affinity: affinity, outline: outline)
    case .group(let groupID, let index):
      return groupPlan(payload: payload, groupID: groupID, index: index, outline: outline)
    case .pinnedEnd:
      let roots = reducedRoots(payload: payload, outline: outline)
      let firstRegular = roots.first(where: { !$0.isPinned })?.entryID
      return TerminalSidebarDropPlan(
        path: path,
        destination: .root(isPinned: true, index: roots.prefix { $0.isPinned }.count),
        placeholder: firstRegular.map(TerminalSidebarDropPlaceholder.before) ?? .beforeFooter
      )
    case .trailingRoot:
      let roots = reducedRoots(payload: payload, outline: outline)
      return TerminalSidebarDropPlan(
        path: path,
        destination: .root(isPinned: false, index: roots.count { !$0.isPinned }),
        placeholder: .beforeFooter
      )
    }
  }

  private static func rootPlan(
    payload: TerminalSidebarDragPayload,
    index: Int,
    affinity: TerminalSidebarRootTargetAffinity,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard outline.roots.indices.contains(index) else { return nil }
    let target = outline.roots[index]
    if case .tab = payload.value, affinity == .before {
      switch target.content {
      case .tab(let targetTabID):
        return TerminalSidebarDropPlan(
          path: .root(index: index, affinity: affinity),
          destination: .createGroup(targetTabID: targetTabID),
          placeholder: .tabHighlight(targetTabID)
        )
      case .group(let groupID, _, _, let tabIDs):
        let destinationIndex = tabIDs.filter { tabID in
          guard case .tab(let sourceID) = payload.value else { return true }
          return tabID != sourceID
        }.count
        return TerminalSidebarDropPlan(
          path: .root(index: index, affinity: affinity),
          destination: .group(groupID, index: destinationIndex),
          placeholder: .groupHighlight(groupID)
        )
      }
    }

    let boundary = index + (affinity == .after ? 1 : 0)
    let reduced = reducedRoots(payload: payload, outline: outline)
    let destinationIndex = outline.roots[..<boundary].count { root in
      root.isPinned == target.isPinned && reduced.contains { $0.id == root.id }
    }
    return TerminalSidebarDropPlan(
      path: .root(index: index, affinity: affinity),
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
    guard case .tab(let sourceID) = payload.value else { return nil }
    let original = outline.tabIDs(in: groupID)
    guard (0...original.count).contains(index) else { return nil }
    let reduced = original.filter { $0 != sourceID }
    let destinationIndex = original.prefix(index).count { $0 != sourceID }
    let placeholder =
      reduced.indices.contains(destinationIndex)
      ? TerminalSidebarDropPlaceholder.before(.tab(reduced[destinationIndex]))
      : .groupEnd(groupID)
    return TerminalSidebarDropPlan(
      path: .group(groupID, index: index),
      destination: .group(groupID, index: destinationIndex),
      placeholder: placeholder
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
    switch payload.value {
    case .group(let sourceID):
      return outline.roots.filter { $0.id != .group(sourceID) }
    case .tab(let sourceID):
      return outline.roots.compactMap { root in
        switch root.content {
        case .tab(let id):
          return id == sourceID ? nil : root
        case .group(let id, let color, let lifetime, let tabIDs):
          guard tabIDs.contains(sourceID) else { return root }
          let children = tabIDs.filter { $0 != sourceID }
          guard lifetime == .durable || !children.isEmpty else { return nil }
          return TerminalSidebarOutline.Root(
            content: .group(id, color, lifetime, children),
            isPinned: root.isPinned
          )
        }
      }
    }
  }
}
