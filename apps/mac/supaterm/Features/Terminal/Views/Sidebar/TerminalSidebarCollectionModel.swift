import CoreGraphics
import Foundation
import SupaTheme
import SupatermCLIShared

struct TerminalRootPlacement: Equatable {
  let isPinned: Bool
  let index: Int
}

enum TerminalSidebarItemLocation: Equatable {
  case root(TerminalRootPlacement)
  case project(TerminalProjectID, index: Int)
  case unassigned(index: Int)
}

enum TerminalSidebarEntryID: Hashable {
  case tab(TerminalTabID)
  case project(TerminalProjectID)
  case unassigned
  case pinDivider
  case newTab
}

enum TerminalSidebarRootContent: Equatable {
  case project(
    TerminalProjectID,
    ThemeTint,
    [TerminalTabID]
  )
  case unassigned([TerminalTabID])
}

struct TerminalSidebarTopologyStamp: Equatable {
  let spaceID: TerminalSpaceID
  let revision: UInt64
  let orderedProjectIDs: [TerminalProjectID]

  init(
    spaceID: TerminalSpaceID,
    revision: UInt64,
    orderedProjectIDs: [TerminalProjectID] = []
  ) {
    self.spaceID = spaceID
    self.revision = revision
    self.orderedProjectIDs = orderedProjectIDs
  }
}

struct TerminalSidebarOutline: Equatable {
  struct Root: Equatable {
    let content: TerminalSidebarRootContent
    let isPinned: Bool

    var id: TerminalSidebarEntryID {
      switch content {
      case .project(let id, _, _): .project(id)
      case .unassigned: .unassigned
      }
    }
  }

  let roots: [Root]
  let collapsedProjectIDs: Set<TerminalProjectID>
  let isUnassignedCollapsed: Bool
  let pinnedTabIDs: Set<TerminalTabID>
  let topologyStamp: TerminalSidebarTopologyStamp?

  init(
    roots: [Root],
    collapsedProjectIDs: Set<TerminalProjectID>,
    isUnassignedCollapsed: Bool = false,
    pinnedTabIDs: Set<TerminalTabID> = [],
    topologyRevision: UInt64,
    spaceID: TerminalSpaceID? = nil,
    orderedProjectIDs: [TerminalProjectID] = []
  ) {
    precondition(spaceID != nil || roots.isEmpty)
    self.roots = roots
    self.collapsedProjectIDs = collapsedProjectIDs
    self.isUnassignedCollapsed = isUnassignedCollapsed
    self.pinnedTabIDs = pinnedTabIDs
    topologyStamp = spaceID.map {
      TerminalSidebarTopologyStamp(
        spaceID: $0,
        revision: topologyRevision,
        orderedProjectIDs: orderedProjectIDs
      )
    }
  }

  init(snapshot: TerminalTabSurfaceSnapshot, projects: [TerminalProject]) {
    let layout = SupatermProjectLayout.make(
      orderedProjectIDs: projects.map(\.id),
      pinnedTabs: snapshot.collection.pinnedTabs.map {
        SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
      },
      regularTabs: snapshot.collection.regularTabs.map {
        SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
      }
    )
    let projectByID = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
    roots = layout.sections.compactMap { section -> Root? in
      if let projectID = section.projectID, let project = projectByID[projectID] {
        return Root(
          content: .project(project.id, project.color, section.tabIDs),
          isPinned: project.isPinned
        )
      }
      return Root(content: .unassigned(section.tabIDs), isPinned: false)
    }
    collapsedProjectIDs = snapshot.collapsedProjectIDs
    isUnassignedCollapsed = snapshot.isUnassignedCollapsed
    pinnedTabIDs = Set(snapshot.collection.pinnedTabs.map(\.id))
    topologyStamp = TerminalSidebarTopologyStamp(
      spaceID: snapshot.spaceID,
      revision: snapshot.collection.topologyRevision,
      orderedProjectIDs: projects.map(\.id)
    )
  }

  var visibleEntries: [TerminalSidebarEntry] {
    var entries: [TerminalSidebarEntry] = []
    let hasPinned = roots.contains(where: \.isPinned)
    let hasRegular = roots.contains { !$0.isPinned }

    for (index, root) in roots.enumerated() {
      if hasPinned, hasRegular, index > 0, roots[index - 1].isPinned, !root.isPinned {
        entries.append(TerminalSidebarEntry(kind: .pinDivider))
      }
      switch root.content {
      case .project(let id, let color, let tabIDs):
        let isCollapsed = collapsedProjectIDs.contains(id)
        entries.append(
          TerminalSidebarEntry(
            kind: .project(id, color: color, isPinned: root.isPinned, isCollapsed: isCollapsed)
          )
        )
        guard !isCollapsed else { continue }
        entries.append(
          contentsOf: tabIDs.map {
            TerminalSidebarEntry(
              kind: .tab(
                $0,
                parentProjectID: id,
                rootIsPinned: pinnedTabIDs.contains($0)
              )
            )
          }
        )
      case .unassigned(let tabIDs):
        entries.append(
          TerminalSidebarEntry(kind: .unassigned(isCollapsed: isUnassignedCollapsed))
        )
        guard !isUnassignedCollapsed else { continue }
        entries.append(
          contentsOf: tabIDs.map {
            TerminalSidebarEntry(
              kind: .tab(
                $0,
                parentProjectID: nil,
                rootIsPinned: pinnedTabIDs.contains($0)
              )
            )
          }
        )
      }
    }

    entries.append(TerminalSidebarEntry(kind: .newTab))

    return entries
  }

  func project(_ id: TerminalProjectID) -> Root? {
    roots.first {
      if case .project(let projectID, _, _) = $0.content { return projectID == id }
      return false
    }
  }

  func tabIDs(in projectID: TerminalProjectID) -> [TerminalTabID] {
    guard let root = project(projectID), case .project(_, _, let tabIDs) = root.content else {
      return []
    }
    return tabIDs
  }

  var unassignedTabIDs: [TerminalTabID] {
    for root in roots {
      if case .unassigned(let tabIDs) = root.content { return tabIDs }
    }
    return []
  }

  func location(of itemID: TerminalTabDragItemID) -> TerminalSidebarItemLocation? {
    for (rootIndex, root) in roots.enumerated() {
      switch (itemID, root.content) {
      case (.project(let itemID), .project(let rootID, _, _)) where itemID == rootID:
        return .root(rootPlacement(at: rootIndex))
      case (.tab(let itemID), .project(let projectID, _, let tabIDs)):
        guard let childIndex = tabIDs.firstIndex(of: itemID) else { continue }
        return .project(projectID, index: childIndex)
      case (.tab(let itemID), .unassigned(let tabIDs)):
        guard let childIndex = tabIDs.firstIndex(of: itemID) else { continue }
        return .unassigned(index: childIndex)
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
    case .project(let id):
      source = .project(id)
    case .unassigned, .pinDivider, .newTab:
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
    case .project(let id):
      let visibleIDs = Set(visibleEntryIDs(forProject: id))
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

  private func visibleEntryIDs(forProject id: TerminalProjectID) -> [TerminalSidebarEntryID] {
    guard let root = project(id), case .project(_, _, let tabIDs) = root.content else { return [] }
    var ids: [TerminalSidebarEntryID] = [.project(id)]
    guard !collapsedProjectIDs.contains(id) else { return ids }
    ids.append(contentsOf: tabIDs.map(TerminalSidebarEntryID.tab))
    return ids
  }
}

struct TerminalSidebarEntry: Equatable {
  enum Kind: Equatable {
    case tab(TerminalTabID, parentProjectID: TerminalProjectID?, rootIsPinned: Bool)
    case project(TerminalProjectID, color: ThemeTint, isPinned: Bool, isCollapsed: Bool)
    case unassigned(isCollapsed: Bool)
    case pinDivider
    case newTab
  }

  let kind: Kind

  var id: TerminalSidebarEntryID {
    switch kind {
    case .tab(let id, _, _): .tab(id)
    case .project(let id, _, _, _): .project(id)
    case .unassigned: .unassigned
    case .pinDivider: .pinDivider
    case .newTab: .newTab
    }
  }

  var parentProjectID: TerminalProjectID? {
    switch kind {
    case .tab(_, let projectID, _): projectID
    case .project, .unassigned, .pinDivider, .newTab: nil
    }
  }
}

enum TerminalSidebarDragSource: Equatable {
  case tabs([TerminalTabID])
  case project(TerminalProjectID)

  var itemIDs: [TerminalTabDragItemID] {
    switch self {
    case .tabs(let ids): ids.map(TerminalTabDragItemID.tab)
    case .project(let id): [.project(id)]
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

enum TerminalSidebarSemanticPath: Equatable {
  case rootItem(index: Int)
  case rootBoundary(index: Int, affinity: TerminalSidebarRootTargetAffinity)
  case project(TerminalProjectID, index: Int)
  case unassigned(index: Int)
  case unassignedHeader
  case pinnedEnd
  case trailingRoot
}

struct TerminalSidebarSemanticTarget: Equatable {
  let path: TerminalSidebarSemanticPath
  let frame: CGRect
}

enum TerminalSidebarDropDestination: Equatable {
  case root(isPinned: Bool, index: Int)
  case project(TerminalProjectID, index: Int)
  case unassigned(index: Int)
}

enum TerminalSidebarDropPlaceholder: Equatable {
  case before(TerminalSidebarEntryID)
  case beforeFooter
  case projectEnd(TerminalProjectID)
  case unassignedEnd
}

enum TerminalSidebarDropOperation: Equatable {
  case assign(TerminalProjectID?)
  case move(TerminalTabPlacement)
  case reorderProject(TerminalRootPlacement)

  var transferDestination: TerminalTabTransferDestination? {
    switch self {
    case .assign(let projectID):
      .assign(projectID)
    case .move(let placement):
      .move(placement)
    case .reorderProject:
      nil
    }
  }
}

struct TerminalSidebarDropPlan: Equatable {
  let path: TerminalSidebarSemanticPath
  let destination: TerminalSidebarDropDestination
  let placeholder: TerminalSidebarDropPlaceholder
  let operation: TerminalSidebarDropOperation

  init(
    path: TerminalSidebarSemanticPath,
    destination: TerminalSidebarDropDestination,
    placeholder: TerminalSidebarDropPlaceholder,
    operation: TerminalSidebarDropOperation
  ) {
    self.path = path
    self.destination = destination
    self.placeholder = placeholder
    self.operation = operation
  }

  var destinationProjectID: TerminalProjectID? {
    switch destination {
    case .project(let projectID, _): projectID
    case .root, .unassigned: nil
    }
  }

  var highlightedProjectID: TerminalProjectID? {
    guard case .assign(let projectID) = operation else { return nil }
    return projectID
  }

  func command(for payload: TerminalSidebarDragPayload) -> TerminalSidebarDropCommand? {
    switch (payload.source, operation) {
    case (.tabs, .assign), (.tabs, .move), (.project, .reorderProject):
      break
    case (.tabs, .reorderProject), (.project, .assign), (.project, .move):
      return nil
    }
    return TerminalSidebarDropCommand(
      operationID: payload.operationID,
      topologyStamp: payload.topologyStamp,
      itemIDs: payload.source.itemIDs,
      operation: operation
    )
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
  let itemIDs: [TerminalTabDragItemID]
  let operation: TerminalSidebarDropOperation
}

struct TerminalSidebarDropReceipt: Equatable {
  let spaceID: TerminalSpaceID
  let operationID: TerminalTabMoveOperationID
  let itemIDs: [TerminalTabDragItemID]
  let operation: TerminalSidebarDropOperation
  let topologyRevision: UInt64
  let orderedProjectIDs: [TerminalProjectID]

  init(
    spaceID: TerminalSpaceID,
    operationID: TerminalTabMoveOperationID,
    itemIDs: [TerminalTabDragItemID],
    operation: TerminalSidebarDropOperation,
    topologyRevision: UInt64,
    orderedProjectIDs: [TerminalProjectID] = []
  ) {
    self.spaceID = spaceID
    self.operationID = operationID
    self.itemIDs = itemIDs
    self.operation = operation
    self.topologyRevision = topologyRevision
    self.orderedProjectIDs = orderedProjectIDs
  }

  var topologyStamp: TerminalSidebarTopologyStamp {
    TerminalSidebarTopologyStamp(
      spaceID: spaceID,
      revision: topologyRevision,
      orderedProjectIDs: orderedProjectIDs
    )
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
    case .rootItem(let lane, let index, let id):
      return rootItemPlan(
        payload: payload,
        lane: lane,
        index: index,
        id: id,
        outline: outline
      )
    case .project(let projectID, let index):
      return sectionPlan(
        payload: payload,
        projectID: projectID,
        index: index,
        outline: outline
      )
    case .unassigned(let index):
      return sectionPlan(payload: payload, projectID: nil, index: index, outline: outline)
    case .unassignedHeader:
      guard case .tabs = payload.source else { return nil }
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: path,
          destination: .unassigned(index: outline.unassignedTabIDs.count),
          placeholder: .unassignedEnd,
          operation: .assign(nil)
        ),
        payload: payload,
        outline: outline
      )
    case .pinnedEnd:
      let roots = reducedRoots(payload: payload, outline: outline)
      let firstRegular = roots.first(where: { !$0.isPinned })?.id
      let placement = TerminalRootPlacement(
        isPinned: true,
        index: roots.prefix { $0.isPinned }.count
      )
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: path,
          destination: .root(isPinned: true, index: placement.index),
          placeholder: firstRegular.map(TerminalSidebarDropPlaceholder.before) ?? .beforeFooter,
          operation: rootOperation(payload: payload, placement: placement, outline: outline)
        ),
        payload: payload,
        groupID: groupID,
        index: index,
        id: id,
        outline: outline
      )
    case .trailingRoot:
      let roots = reducedRoots(payload: payload, outline: outline)
      let placement = TerminalRootPlacement(
        isPinned: false,
        index: roots.count { !$0.isPinned }
      )
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: path,
          destination: .root(isPinned: false, index: placement.index),
          placeholder: .beforeFooter,
          operation: rootOperation(payload: payload, placement: placement, outline: outline)
        ),
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
    guard outline.roots.indices.contains(index) else { return nil }
    let target = outline.roots[index]
    if case .tabs(let sourceIDs) = payload.source,
      case .project(let projectID, _, let tabIDs) = target.content
    {
      let selected = Set(sourceIDs)
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: .rootItem(index: index),
          destination: .project(projectID, index: tabIDs.count { !selected.contains($0) }),
          placeholder: .projectEnd(projectID),
          operation: .assign(projectID)
        ),
        payload: payload,
        outline: outline
      )
    }
    if case .tabs = payload.source, case .unassigned(let tabIDs) = target.content {
      return rejectingNoOp(
        TerminalSidebarDropPlan(
          path: .rootItem(index: index),
          destination: .unassigned(index: tabIDs.count),
          placeholder: .unassignedEnd,
          operation: .assign(nil)
        ),
        payload: payload,
        outline: outline
      )
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
      ),
      operation: rootOperation(
        payload: payload,
        placement: TerminalRootPlacement(isPinned: target.isPinned, index: destinationIndex),
        outline: outline
      )
    )
  }

  private static func rootOperation(
    payload: TerminalSidebarDragPayload,
    placement: TerminalRootPlacement,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropOperation {
    switch payload.source {
    case .project:
      return .reorderProject(placement)
    case .tabs(let tabIDs):
      let selected = Set(tabIDs)
      let index = outline.unassignedTabIDs.count {
        !selected.contains($0) && outline.pinnedTabIDs.contains($0) == placement.isPinned
      }
      return .move(
        TerminalTabPlacement(projectID: nil, isPinned: placement.isPinned, index: index)
      )
    }
  }

  private static func sectionPlan(
    payload: TerminalSidebarDragPayload,
    projectID: TerminalProjectID?,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> TerminalSidebarDropPlan? {
    guard case .tabs(let sourceIDs) = payload.source else { return nil }
    let original = projectID.map(outline.tabIDs(in:)) ?? outline.unassignedTabIDs
    guard (0...original.count).contains(index) else { return nil }
    let selected = Set(sourceIDs)
    let destinationIndex = original.prefix(index).count { !selected.contains($0) }
    let isPinned = destinationPinState(
      at: index,
      in: original,
      pinnedTabIDs: outline.pinnedTabIDs
    )
    let laneIndex = original.prefix(index).count {
      !selected.contains($0) && outline.pinnedTabIDs.contains($0) == isPinned
    }
    let placeholder =
      reduced.indices.contains(destinationIndex)
      ? TerminalSidebarDropPlaceholder.before(.tab(reduced[destinationIndex]))
      : projectID.map(TerminalSidebarDropPlaceholder.projectEnd) ?? .unassignedEnd
    let path =
      projectID.map { TerminalSidebarSemanticPath.project($0, index: index) }
      ?? .unassigned(index: index)
    let destination =
      projectID.map {
        TerminalSidebarDropDestination.project($0, index: destinationIndex)
      } ?? .unassigned(index: destinationIndex)
    return rejectingNoOp(
      TerminalSidebarDropPlan(
        path: path,
        destination: destination,
        placeholder: placeholder,
        operation: .move(
          TerminalTabPlacement(
            projectID: projectID,
            isPinned: isPinned,
            index: laneIndex
          )
        )
      ),
      payload: payload,
      outline: outline
    )
  }

  private static func destinationPinState(
    at index: Int,
    in tabIDs: [TerminalTabID],
    pinnedTabIDs: Set<TerminalTabID>
  ) -> Bool {
    if tabIDs.indices.contains(index) {
      return pinnedTabIDs.contains(tabIDs[index])
    }
    return tabIDs.last.map(pinnedTabIDs.contains) ?? false
  }

  private static func rootPlaceholder(
    lane: TerminalSidebarRootLane,
    index: Int,
    reducedRoots: [TerminalSidebarOutline.Root]
  ) -> TerminalSidebarDropPlaceholder {
    let survivingIDs = Set(reducedRoots.map(\.id))
    if let next = outline.roots.dropFirst(boundary).first(where: {
      $0.isPinned == isPinned && survivingIDs.contains($0.id)
    }) {
      return .before(next.id)
    }
    if isPinned, let firstRegular = reducedRoots.first(where: { !$0.isPinned }) {
      return .before(firstRegular.id)
    }
    return .beforeFooter
  }

  private static func reducedRoots(
    payload: TerminalSidebarDragPayload,
    outline: TerminalSidebarOutline
  ) -> [TerminalSidebarOutline.Root] {
    switch payload.source {
    case .project(let sourceID):
      return outline.roots.filter { $0.id != .project(sourceID) }
    case .tabs(let sourceIDs):
      let selected = Set(sourceIDs)
      return outline.roots.compactMap { root in
        switch root.content {
        case .project(let id, let color, let tabIDs):
          guard tabIDs.contains(where: selected.contains) else { return root }
          let children = tabIDs.filter { !selected.contains($0) }
          guard !children.isEmpty else { return nil }
          return TerminalSidebarOutline.Root(
            content: .project(id, color, children),
            isPinned: root.isPinned
          )
        case .unassigned(let tabIDs):
          let children = tabIDs.filter { !selected.contains($0) }
          guard !children.isEmpty else { return nil }
          return TerminalSidebarOutline.Root(
            content: .unassigned(children),
            isPinned: false
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
      return isNoOpRoot(
        itemIDs,
        isPinned: isPinned,
        index: index,
        outline: outline
      )
    case .project(let projectID, let index):
      return isNoOpProject(itemIDs, projectID: projectID, index: index, outline: outline)
    case .unassigned(let index):
      return isNoOpUnassigned(itemIDs, index: index, outline: outline)
    }
  }

  private static func isNoOpRoot(
    _ itemIDs: [TerminalTabDragItemID],
    isPinned: Bool,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> Bool {
    guard
      itemIDs.allSatisfy({ itemID in
        guard case .root(let placement) = outline.location(of: itemID) else { return false }
        return placement.isPinned == isPinned
      })
    else { return false }
    let entryIDs = itemIDs.map(\.entryID)
    let current = outline.roots.filter { $0.isPinned == isPinned }.map(\.id)
    return moving(entryIDs, to: index, in: current) == current
  }

  private static func isNoOpProject(
    _ itemIDs: [TerminalTabDragItemID],
    projectID: TerminalProjectID,
    index: Int,
    outline: TerminalSidebarOutline
  ) -> Bool {
    guard let tabIDs = tabIDs(itemIDs) else { return false }
    guard
      tabIDs.allSatisfy({ tabID in
        if case .project(let currentProjectID, _) = outline.location(of: .tab(tabID)) {
          return currentProjectID == projectID
        }
        return false
      })
    else { return false }
    let current = outline.tabIDs(in: projectID)
    return moving(tabIDs, to: index, in: current) == current
  }

  private static func isNoOpUnassigned(
    _ itemIDs: [TerminalTabDragItemID],
    index: Int,
    outline: TerminalSidebarOutline
  ) -> Bool {
    guard let tabIDs = tabIDs(itemIDs) else { return false }
    guard
      tabIDs.allSatisfy({ tabID in
        if case .unassigned = outline.location(of: .tab(tabID)) { return true }
        return false
      })
    else { return false }
    let current = outline.unassignedTabIDs
    return moving(tabIDs, to: index, in: current) == current
  }

  private static func tabIDs(_ itemIDs: [TerminalTabDragItemID]) -> [TerminalTabID]? {
    let tabIDs = itemIDs.compactMap { itemID -> TerminalTabID? in
      guard case .tab(let tabID) = itemID else { return nil }
      return tabID
    }
    return tabIDs.count == itemIDs.count ? tabIDs : nil
  }

  private static func moving<ID: Equatable>(
    _ movingIDs: [ID],
    to index: Int,
    in current: [ID]
  ) -> [ID]? {
    var result = current.filter { !movingIDs.contains($0) }
    guard (0...result.count).contains(index) else { return nil }
    result.insert(contentsOf: movingIDs, at: index)
    return result
  }
}

extension TerminalTabDragItemID {
  fileprivate var entryID: TerminalSidebarEntryID {
    switch self {
    case .tab(let id):
      return .tab(id)
    case .project(let id):
      return .project(id)
    }
  }
}
