import Foundation

nonisolated enum TerminalTabDragItemKind: String, Codable, Sendable {
  case group
  case tab
}

nonisolated struct TerminalTabDragPayload: Codable, Equatable, Sendable {
  enum Source: Codable, Equatable, Sendable {
    case rootItems([Item])
    case pane(Pane)
  }

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

  static let schemaVersion = 2

  let version: Int
  let operationID: UUID
  let sourceWindowID: UUID
  let sourceSpaceID: TerminalSpaceID
  let sourceTopologyRevision: UInt64
  let source: Source

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
    source = .rootItems(itemIDs.map(Item.init))
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
    source = .pane(Pane(surfaceID: surfaceID, destinationTabID: destinationTabID))
  }

  var moveOperationID: TerminalTabMoveOperationID {
    TerminalTabMoveOperationID(rawValue: operationID)
  }

  var itemIDs: [TerminalTabRootItemID] {
    guard case .rootItems(let items) = source else { return [] }
    return items.map(\.rootItemID)
  }

  var singleTabID: TerminalTabID? {
    guard case .rootItems(let items) = source else { return nil }
    guard items.count == 1, items[0].kind == .tab else { return nil }
    return TerminalTabID(rawValue: items[0].id)
  }

  var isValid: Bool {
    guard version == Self.schemaVersion else { return false }
    switch source {
    case .rootItems(let items):
      return !items.isEmpty && Set(items).count == items.count
    case .pane:
      return true
    }
  }
}
