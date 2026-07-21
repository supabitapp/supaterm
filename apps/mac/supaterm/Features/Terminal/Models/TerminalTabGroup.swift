import Foundation

nonisolated struct TerminalTabGroupID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    rawValue = try container.decode(UUID.self)
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }

  var id: UUID { rawValue }
}

nonisolated enum TerminalTabGroupColor: String, CaseIterable, Codable, Sendable {
  case neutral
  case red
  case orange
  case yellow
  case green
  case blue
  case pink
  case purple
}

nonisolated enum TerminalTabGroupLifetime: Equatable, Sendable {
  case durable
  case automatic
}

nonisolated struct TerminalTabGroup: Identifiable, Equatable, Sendable {
  let id: TerminalTabGroupID
  var title: String
  var color: TerminalTabGroupColor
  let lifetime: TerminalTabGroupLifetime
}

nonisolated struct TerminalUngroupedTabItem: Equatable, Sendable {
  var tab: TerminalTabItem
  var isPinned: Bool
}

nonisolated struct TerminalTabGroupItem: Identifiable, Equatable, Sendable {
  let id: TerminalTabGroupID
  var title: String
  var color: TerminalTabGroupColor
  var isPinned: Bool
  var tabs: [TerminalTabItem]
  var lifetime: TerminalTabGroupLifetime

  init(
    id: TerminalTabGroupID = TerminalTabGroupID(),
    title: String,
    color: TerminalTabGroupColor,
    isPinned: Bool,
    tabs: [TerminalTabItem],
    lifetime: TerminalTabGroupLifetime = .durable
  ) {
    self.id = id
    self.title = title
    self.color = color
    self.isPinned = isPinned
    self.tabs = tabs
    self.lifetime = lifetime
  }
}

nonisolated enum TerminalTabRootItemID: Hashable, Sendable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)
}

nonisolated enum TerminalTabRootItem: Identifiable, Equatable, Sendable {
  case tab(TerminalUngroupedTabItem)
  case group(TerminalTabGroupItem)

  var id: TerminalTabRootItemID {
    switch self {
    case .tab(let item):
      return .tab(item.tab.id)
    case .group(let group):
      return .group(group.id)
    }
  }

  var isPinned: Bool {
    switch self {
    case .tab(let item):
      return item.isPinned
    case .group(let group):
      return group.isPinned
    }
  }

  var tabs: [TerminalTabItem] {
    switch self {
    case .tab(let item):
      return [item.tab]
    case .group(let group):
      return group.tabs
    }
  }
}

nonisolated struct TerminalRootPlacement: Equatable, Sendable {
  let isPinned: Bool
  let index: Int
}

nonisolated enum TerminalTabPlacement: Equatable, Sendable {
  case root(TerminalRootPlacement)
  case group(TerminalTabGroupID, index: Int)
}

nonisolated struct TerminalTabMoveOperationID: Hashable, Sendable {
  let rawValue: UUID

  init(rawValue: UUID = UUID()) {
    self.rawValue = rawValue
  }
}

nonisolated struct TerminalTabMoveRequest: Equatable, Sendable {
  let operationID: TerminalTabMoveOperationID
  let expectedTopologyRevision: UInt64
  let itemIDs: [TerminalTabRootItemID]
  let destination: TerminalTabPlacement

  init(
    operationID: TerminalTabMoveOperationID = TerminalTabMoveOperationID(),
    expectedTopologyRevision: UInt64,
    itemIDs: [TerminalTabRootItemID],
    destination: TerminalTabPlacement
  ) {
    self.operationID = operationID
    self.expectedTopologyRevision = expectedTopologyRevision
    self.itemIDs = itemIDs
    self.destination = destination
  }
}

nonisolated struct TerminalTabMoveResult: Equatable, Sendable {
  let operationID: TerminalTabMoveOperationID
  let itemIDs: [TerminalTabRootItemID]
  let location: TerminalTabPlacement
  let deletedEmptyGroupIDs: [TerminalTabGroupID]
  let topologyRevision: UInt64
}

nonisolated struct TerminalTabGroupCreationResult: Equatable, Sendable {
  let groupID: TerminalTabGroupID
  let deletedEmptyGroupIDs: [TerminalTabGroupID]
  let topologyRevision: UInt64
}

nonisolated struct TerminalTabCloseResult: Equatable, Sendable {
  let deletedEmptyGroupIDs: [TerminalTabGroupID]
  let topologyRevision: UInt64
}

nonisolated enum TerminalTabMoveError: Error, Equatable {
  case ancestorAndDescendant(TerminalTabGroupID, TerminalTabID)
  case duplicateItem(TerminalTabRootItemID)
  case emptyItems
  case invalidDestination(TerminalTabPlacement)
  case itemNotFound(TerminalTabRootItemID)
  case staleTopology(expected: UInt64, actual: UInt64)
}
