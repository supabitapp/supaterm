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

  init(
    id: TerminalTabGroupID = TerminalTabGroupID(),
    title: String,
    color: TerminalTabGroupColor,
    isPinned: Bool,
    tabs: [TerminalTabItem]
  ) {
    self.id = id
    self.title = title
    self.color = color
    self.isPinned = isPinned
    self.tabs = tabs
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
