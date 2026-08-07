import Foundation

nonisolated enum TerminalTabDragItemKind: String, Codable, Sendable {
  case group
  case tab
}

nonisolated struct TerminalTabDragPayload: Codable, Equatable, Sendable {
  struct Item: Codable, Hashable, Sendable {
    let id: UUID
    let kind: TerminalTabDragItemKind

    init(_ itemID: TerminalTabRootItemID) {
      switch itemID {
      case .group(let groupID):
        id = groupID.rawValue
        kind = .group
      case .tab(let tabID):
        id = tabID.rawValue
        kind = .tab
      }
    }

    var rootItemID: TerminalTabRootItemID {
      switch kind {
      case .group:
        .group(TerminalTabGroupID(rawValue: id))
      case .tab:
        .tab(TerminalTabID(rawValue: id))
      }
    }
  }

  static let schemaVersion = 1

  let version: Int
  let operationID: UUID
  let sourceWindowID: UUID
  let sourceSpaceID: TerminalSpaceID
  let sourceTopologyRevision: UInt64
  let items: [Item]

  init?(
    operationID: TerminalTabMoveOperationID,
    sourceWindowID: UUID,
    sourceSpaceID: TerminalSpaceID,
    sourceTopologyRevision: UInt64,
    itemIDs: [TerminalTabRootItemID]
  ) {
    guard !itemIDs.isEmpty, Set(itemIDs).count == itemIDs.count else { return nil }
    version = Self.schemaVersion
    self.operationID = operationID.rawValue
    self.sourceWindowID = sourceWindowID
    self.sourceSpaceID = sourceSpaceID
    self.sourceTopologyRevision = sourceTopologyRevision
    items = itemIDs.map(Item.init)
  }

  var moveOperationID: TerminalTabMoveOperationID {
    TerminalTabMoveOperationID(rawValue: operationID)
  }

  var itemIDs: [TerminalTabRootItemID] {
    items.map(\.rootItemID)
  }

  var isValid: Bool {
    version == Self.schemaVersion
      && !items.isEmpty
      && Set(items).count == items.count
  }
}
