import Foundation

nonisolated enum TerminalTabDragItemKind: String, Codable, Sendable {
  case group
  case tab
}

nonisolated struct TerminalTabDragPayload: Codable, Equatable, Sendable {
  struct Pane: Codable, Equatable, Sendable {
    let surfaceID: UUID
    let destinationTabID: TerminalTabID
  }

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
  let pane: Pane?

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
    pane = nil
  }

  init(
    operationID: TerminalTabMoveOperationID,
    sourceWindowID: UUID,
    sourceSpaceID: TerminalSpaceID,
    sourceTopologyRevision: UInt64,
    surfaceID: UUID,
    destinationTabID: TerminalTabID
  ) {
    version = Self.schemaVersion
    self.operationID = operationID.rawValue
    self.sourceWindowID = sourceWindowID
    self.sourceSpaceID = sourceSpaceID
    self.sourceTopologyRevision = sourceTopologyRevision
    items = []
    pane = Pane(surfaceID: surfaceID, destinationTabID: destinationTabID)
  }

  var moveOperationID: TerminalTabMoveOperationID {
    TerminalTabMoveOperationID(rawValue: operationID)
  }

  var itemIDs: [TerminalTabRootItemID] {
    items.map(\.rootItemID)
  }

  var singleTabID: TerminalTabID? {
    guard items.count == 1, items[0].kind == .tab else { return nil }
    return TerminalTabID(rawValue: items[0].id)
  }

  var isValid: Bool {
    guard version == Self.schemaVersion else { return false }
    if pane != nil {
      return items.isEmpty
    }
    return !items.isEmpty && Set(items).count == items.count
  }
}
