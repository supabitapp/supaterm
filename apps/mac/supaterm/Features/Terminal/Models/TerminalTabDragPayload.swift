import Foundation

nonisolated enum TerminalTabDragItemKind: String, Codable, Sendable {
  case project
  case tab
}

nonisolated enum TerminalTabDragItemID: Hashable, Sendable {
  case project(TerminalProjectID)
  case tab(TerminalTabID)
}

nonisolated struct TerminalTabDragPayload: Codable, Equatable, Sendable {
  struct Item: Codable, Hashable, Sendable {
    let id: UUID
    let kind: TerminalTabDragItemKind

    init(_ itemID: TerminalTabDragItemID) {
      switch itemID {
      case .project(let projectID):
        id = projectID.rawValue
        kind = .project
      case .tab(let tabID):
        id = tabID.rawValue
        kind = .tab
      }
    }

    var itemID: TerminalTabDragItemID {
      switch kind {
      case .project:
        .project(TerminalProjectID(rawValue: id))
      case .tab:
        .tab(TerminalTabID(rawValue: id))
      }
    }
  }

  static let schemaVersion = 2

  let version: Int
  let operationID: UUID
  let sourceWindowID: UUID
  let sourceSpaceID: TerminalSpaceID
  let sourceTopologyRevision: UInt64
  let orderedProjectIDs: [TerminalProjectID]
  let items: [Item]

  init?(
    operationID: TerminalTabMoveOperationID,
    sourceWindowID: UUID,
    sourceSpaceID: TerminalSpaceID,
    sourceTopologyRevision: UInt64,
    orderedProjectIDs: [TerminalProjectID],
    itemIDs: [TerminalTabDragItemID]
  ) {
    guard !itemIDs.isEmpty, Set(itemIDs).count == itemIDs.count else { return nil }
    version = Self.schemaVersion
    self.operationID = operationID.rawValue
    self.sourceWindowID = sourceWindowID
    self.sourceSpaceID = sourceSpaceID
    self.sourceTopologyRevision = sourceTopologyRevision
    self.orderedProjectIDs = orderedProjectIDs
    items = itemIDs.map(Item.init)
  }

  var moveOperationID: TerminalTabMoveOperationID {
    TerminalTabMoveOperationID(rawValue: operationID)
  }

  var itemIDs: [TerminalTabDragItemID] {
    items.map(\.itemID)
  }

  var tabIDs: [TerminalTabID] {
    itemIDs.compactMap {
      guard case .tab(let tabID) = $0 else { return nil }
      return tabID
    }
  }

  var singleTabID: TerminalTabID? {
    guard itemIDs.count == 1, case .tab(let tabID) = itemIDs[0] else { return nil }
    return tabID
  }

  var isValid: Bool {
    version == Self.schemaVersion
      && !items.isEmpty
      && Set(items).count == items.count
      && Set(orderedProjectIDs).count == orderedProjectIDs.count
  }
}
