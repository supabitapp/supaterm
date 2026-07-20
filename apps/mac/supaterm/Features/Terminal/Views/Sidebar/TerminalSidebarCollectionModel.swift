import CoreGraphics
import Foundation

enum TerminalSidebarEntryID: Hashable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)
  case emptyGroup(TerminalTabGroupID)
  case pinDivider
  case newTab
  case newGroup
}

enum TerminalSidebarRootContent: Equatable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID, TerminalTabGroupColor, [TerminalTabID])
}

struct TerminalSidebarOutline: Equatable {
  struct Root: Equatable {
    let content: TerminalSidebarRootContent
    let isPinned: Bool

    var id: TerminalTabRootItemID {
      switch content {
      case .tab(let id): .tab(id)
      case .group(let id, _, _): .group(id)
      }
    }
  }

  let roots: [Root]
  let collapsedGroupIDs: Set<TerminalTabGroupID>

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
        entries.append(TerminalSidebarEntry(kind: .tab(id, parentGroupID: nil, rootIsPinned: root.isPinned)))
      case .group(let id, let color, let tabIDs):
        let isCollapsed = collapsedGroupIDs.contains(id)
        entries.append(
          TerminalSidebarEntry(
            kind: .group(id, color: color, isPinned: root.isPinned, isCollapsed: isCollapsed)
          )
        )
        guard !isCollapsed else { continue }
        if tabIDs.isEmpty {
          entries.append(TerminalSidebarEntry(kind: .emptyGroup(id)))
        } else {
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

  func root(containing tabID: TerminalTabID) -> Root? {
    roots.first { root in
      switch root.content {
      case .tab(let id): id == tabID
      case .group(_, _, let tabIDs): tabIDs.contains(tabID)
      }
    }
  }

  func group(_ id: TerminalTabGroupID) -> Root? {
    roots.first {
      if case .group(let groupID, _, _) = $0.content { return groupID == id }
      return false
    }
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    guard let root = group(groupID), case .group(_, _, let tabIDs) = root.content else { return [] }
    return tabIDs
  }

  func visibleEntryIDs(for drag: TerminalSidebarDragValue) -> Set<TerminalSidebarEntryID> {
    switch drag {
    case .tab(let id):
      return [.tab(id)]
    case .group(let id):
      var ids: Set<TerminalSidebarEntryID> = [.group(id)]
      guard !collapsedGroupIDs.contains(id) else { return ids }
      let tabIDs = tabIDs(in: id)
      if tabIDs.isEmpty {
        ids.insert(.emptyGroup(id))
      } else {
        ids.formUnion(tabIDs.map(TerminalSidebarEntryID.tab))
      }
      return ids
    }
  }
}

struct TerminalSidebarEntry: Equatable {
  enum Kind: Equatable {
    case tab(TerminalTabID, parentGroupID: TerminalTabGroupID?, rootIsPinned: Bool)
    case group(TerminalTabGroupID, color: TerminalTabGroupColor, isPinned: Bool, isCollapsed: Bool)
    case emptyGroup(TerminalTabGroupID)
    case pinDivider
    case newTab
    case newGroup
  }

  let kind: Kind

  var id: TerminalSidebarEntryID {
    switch kind {
    case .tab(let id, _, _): .tab(id)
    case .group(let id, _, _, _): .group(id)
    case .emptyGroup(let id): .emptyGroup(id)
    case .pinDivider: .pinDivider
    case .newTab: .newTab
    case .newGroup: .newGroup
    }
  }

  var parentGroupID: TerminalTabGroupID? {
    switch kind {
    case .tab(_, let groupID, _): groupID
    case .emptyGroup(let groupID): groupID
    case .group, .pinDivider, .newTab, .newGroup: nil
    }
  }
}

enum TerminalSidebarDragValue: Equatable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)

  init?(pasteboardValue: String) {
    let components = pasteboardValue.split(separator: ":", maxSplits: 1).map(String.init)
    guard components.count == 2, let rawValue = UUID(uuidString: components[1]) else { return nil }
    switch components[0] {
    case "tab": self = .tab(TerminalTabID(rawValue: rawValue))
    case "group": self = .group(TerminalTabGroupID(rawValue: rawValue))
    default: return nil
    }
  }

  var pasteboardValue: String {
    switch self {
    case .tab(let id): "tab:\(id.rawValue.uuidString)"
    case .group(let id): "group:\(id.rawValue.uuidString)"
    }
  }
}

enum TerminalSidebarDropDestination: Equatable {
  case root(isPinned: Bool, index: Int)
  case group(TerminalTabGroupID, index: Int)
  case createGroup(targetTabID: TerminalTabID)
}

struct TerminalSidebarDropTarget: Equatable {
  enum Presentation: Equatable {
    case rootGap
    case groupGap(TerminalTabGroupID)
    case groupHighlight(TerminalTabGroupID)
    case combineHighlight(TerminalTabID)
  }

  let destination: TerminalSidebarDropDestination
  let insertionEntryIndex: Int?
  let presentation: Presentation
}

enum TerminalSidebarDropCommit {
  static func isApplied(
    drag: TerminalSidebarDragValue,
    destination: TerminalSidebarDropDestination,
    outline: TerminalSidebarOutline
  ) -> Bool {
    switch (drag, destination) {
    case (.group(let id), .root(let isPinned, let expectedIndex)):
      let lane = outline.roots.filter { $0.isPinned == isPinned }
      return lane.indices.contains(expectedIndex) && lane[expectedIndex].id == .group(id)
    case (.tab(let id), .root(let isPinned, let expectedIndex)):
      let lane = outline.roots.filter { $0.isPinned == isPinned }
      return lane.indices.contains(expectedIndex) && lane[expectedIndex].id == .tab(id)
    case (.tab(let id), .group(let groupID, let expectedIndex)):
      let tabIDs = outline.tabIDs(in: groupID)
      return tabIDs.indices.contains(expectedIndex) && tabIDs[expectedIndex] == id
    case (.tab(let sourceID), .createGroup(let targetID)):
      guard
        let root = outline.roots.first(where: { root in
          guard case .group(_, _, let tabIDs) = root.content else { return false }
          return tabIDs == [targetID, sourceID]
        })
      else { return false }
      if case .group = root.content { return true }
      return false
    default:
      return false
    }
  }
}

enum TerminalSidebarDropTargetResolver {
  static func resolve(
    drag: TerminalSidebarDragValue,
    pointerY: CGFloat,
    outline: TerminalSidebarOutline,
    frames: [TerminalSidebarEntryID: CGRect],
    groupFrames: [TerminalTabGroupID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    switch drag {
    case .group(let id):
      return rootTarget(
        sourceRootID: .group(id),
        pointerY: pointerY,
        outline: outline,
        frames: frames
      )
    case .tab(let id):
      return tabTarget(
        id: id,
        pointerY: pointerY,
        outline: outline,
        frames: frames,
        groupFrames: groupFrames
      )
    }
  }

  private static func tabTarget(
    id: TerminalTabID,
    pointerY: CGFloat,
    outline: TerminalSidebarOutline,
    frames: [TerminalSidebarEntryID: CGRect],
    groupFrames: [TerminalTabGroupID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    let entries = outline.visibleEntries
    let sourceRootID: TerminalTabRootItemID?
    if let sourceRoot = outline.root(containing: id), case .tab = sourceRoot.content {
      sourceRootID = sourceRoot.id
    } else {
      sourceRootID = nil
    }

    for entry in entries {
      guard let frame = frames[entry.id], frame.minY...frame.maxY ~= pointerY else { continue }
      switch entry.kind {
      case .group(let groupID, _, _, _), .emptyGroup(let groupID):
        let index = outline.tabIDs(in: groupID).filter { $0 != id }.count
        return TerminalSidebarDropTarget(
          destination: .group(groupID, index: index),
          insertionEntryIndex: nil,
          presentation: .groupHighlight(groupID)
        )
      case .tab(let targetID, let parentGroupID?, _):
        guard targetID != id else { break }
        let tabIDs = outline.tabIDs(in: parentGroupID).filter { $0 != id }
        guard let targetIndex = tabIDs.firstIndex(of: targetID) else { break }
        let index = pointerY < frame.midY ? targetIndex : targetIndex + 1
        return TerminalSidebarDropTarget(
          destination: .group(parentGroupID, index: index),
          insertionEntryIndex: groupInsertionIndex(
            groupID: parentGroupID,
            index: index,
            sourceTabID: id,
            entries: entries
          ),
          presentation: .groupGap(parentGroupID)
        )
      case .tab(let targetID, nil, let isPinned):
        guard targetID != id else { break }
        let relativeY = (pointerY - frame.minY) / max(frame.height, 1)
        if relativeY >= 0.25, relativeY <= 0.75 {
          return TerminalSidebarDropTarget(
            destination: .createGroup(targetTabID: targetID),
            insertionEntryIndex: nil,
            presentation: .combineHighlight(targetID)
          )
        }
        let roots = outline.roots.filter { $0.id != .tab(id) && $0.isPinned == isPinned }
        guard let targetIndex = roots.firstIndex(where: { $0.id == .tab(targetID) }) else { break }
        let index = relativeY < 0.25 ? targetIndex : targetIndex + 1
        return TerminalSidebarDropTarget(
          destination: .root(isPinned: isPinned, index: index),
          insertionEntryIndex: rootInsertionIndex(
            isPinned: isPinned,
            index: index,
            sourceRootID: sourceRootID,
            outline: outline
          ),
          presentation: .rootGap
        )
      case .pinDivider, .newTab, .newGroup:
        break
      }
    }

    for (groupID, frame) in groupFrames where frame.minY...frame.maxY ~= pointerY {
      let tabIDs = outline.tabIDs(in: groupID).filter { $0 != id }
      let index =
        tabIDs.firstIndex { tabID in
          guard let frame = frames[.tab(tabID)] else { return false }
          return pointerY < frame.midY
        } ?? tabIDs.count
      return TerminalSidebarDropTarget(
        destination: .group(groupID, index: index),
        insertionEntryIndex: groupInsertionIndex(
          groupID: groupID,
          index: index,
          sourceTabID: id,
          entries: entries
        ),
        presentation: .groupGap(groupID)
      )
    }

    return rootTarget(
      sourceRootID: sourceRootID,
      pointerY: pointerY,
      outline: outline,
      frames: frames
    )
  }

  private static func rootTarget(
    sourceRootID: TerminalTabRootItemID?,
    pointerY: CGFloat,
    outline: TerminalSidebarOutline,
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    let roots = outline.roots.filter { $0.id != sourceRootID }
    guard !roots.isEmpty else {
      let isPinned = sourceRootID.flatMap { id in outline.roots.first(where: { $0.id == id })?.isPinned } ?? false
      return TerminalSidebarDropTarget(
        destination: .root(isPinned: isPinned, index: 0),
        insertionEntryIndex: rootInsertionIndex(
          isPinned: isPinned,
          index: 0,
          sourceRootID: sourceRootID,
          outline: outline
        ),
        presentation: .rootGap
      )
    }

    let anchors = roots.compactMap { root -> (TerminalSidebarOutline.Root, CGRect)? in
      let entryID: TerminalSidebarEntryID
      switch root.id {
      case .tab(let id): entryID = .tab(id)
      case .group(let id): entryID = .group(id)
      }
      guard let frame = frames[entryID] else { return nil }
      return (root, frame)
    }
    guard !anchors.isEmpty else { return nil }
    let insertionOffset = anchors.firstIndex { pointerY < $0.1.midY } ?? anchors.count
    let isPinned = pinLane(
      pointerY: pointerY,
      previous: anchors[safe: insertionOffset - 1],
      next: anchors[safe: insertionOffset],
      fallback: sourceRootID.flatMap { id in outline.roots.first(where: { $0.id == id })?.isPinned } ?? false
    )
    let index = anchors.prefix(insertionOffset).count { $0.0.isPinned == isPinned }
    return TerminalSidebarDropTarget(
      destination: .root(isPinned: isPinned, index: index),
      insertionEntryIndex: rootInsertionIndex(
        isPinned: isPinned,
        index: index,
        sourceRootID: sourceRootID,
        outline: outline
      ),
      presentation: .rootGap
    )
  }

  private static func pinLane(
    pointerY: CGFloat,
    previous: (TerminalSidebarOutline.Root, CGRect)?,
    next: (TerminalSidebarOutline.Root, CGRect)?,
    fallback: Bool
  ) -> Bool {
    switch (previous, next) {
    case (_, let next?) where pointerY >= next.1.minY:
      return next.0.isPinned
    case (let previous?, .some):
      return previous.0.isPinned
    case (nil, let next?):
      return next.0.isPinned
    case (let previous?, nil):
      if pointerY <= previous.1.maxY { return previous.0.isPinned }
      return previous.0.isPinned && fallback
    default:
      return fallback
    }
  }

  private static func rootInsertionIndex(
    isPinned: Bool,
    index: Int,
    sourceRootID: TerminalTabRootItemID?,
    outline: TerminalSidebarOutline
  ) -> Int {
    let roots = outline.roots.filter { $0.id != sourceRootID }
    let lane = roots.filter { $0.isPinned == isPinned }
    let entryID: TerminalSidebarEntryID?
    if lane.indices.contains(index) {
      switch lane[index].id {
      case .tab(let id): entryID = .tab(id)
      case .group(let id): entryID = .group(id)
      }
    } else if isPinned, let firstRegular = roots.first(where: { !$0.isPinned }) {
      switch firstRegular.id {
      case .tab(let id): entryID = .tab(id)
      case .group(let id): entryID = .group(id)
      }
    } else {
      entryID = .newTab
    }
    guard let entryID else { return outline.visibleEntries.count }
    return outline.visibleEntries.firstIndex(where: { $0.id == entryID }) ?? outline.visibleEntries.count
  }

  private static func groupInsertionIndex(
    groupID: TerminalTabGroupID,
    index: Int,
    sourceTabID: TerminalTabID,
    entries: [TerminalSidebarEntry]
  ) -> Int {
    let lane = entries.enumerated().compactMap { offset, entry -> Int? in
      guard case .tab(let id, let parentGroupID, _) = entry.kind,
        parentGroupID == groupID,
        id != sourceTabID
      else { return nil }
      return offset
    }
    if lane.indices.contains(index) { return lane[index] }
    guard let header = entries.firstIndex(where: { $0.id == .group(groupID) }) else { return entries.count }
    return entries[(header + 1)...].firstIndex { entry in
      switch entry.kind {
      case .group, .pinDivider, .newTab, .newGroup: true
      case .tab, .emptyGroup: false
      }
    } ?? entries.count
  }
}

extension Array {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
