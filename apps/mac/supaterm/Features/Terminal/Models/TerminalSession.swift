import Foundation

nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 1
  static let `default` = Self(windows: [])

  let version: Int
  var windows: [TerminalWindowSession]

  init(
    version: Int = Self.currentVersion,
    windows: [TerminalWindowSession]
  ) {
    self.version = version
    self.windows = windows
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(Int.self, forKey: .version)
    guard version == Self.currentVersion else {
      throw DecodingError.dataCorruptedError(
        forKey: .version,
        in: container,
        debugDescription: "Unsupported session version: \(version)"
      )
    }
    self.version = version
    self.windows = try container.decode([TerminalWindowSession].self, forKey: .windows)
  }

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("session.json", isDirectory: false)
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }
}

nonisolated struct TerminalWindowSession: Equatable, Codable, Sendable {
  var selectedSpaceID: TerminalSpaceID
  var spaces: [TerminalWindowSpaceSession]

  func pruned(validSpaceIDs: Set<TerminalSpaceID>) -> TerminalWindowSession? {
    var seenSpaceIDs: Set<TerminalSpaceID> = []
    let spaces = spaces.compactMap { space -> TerminalWindowSpaceSession? in
      guard validSpaceIDs.contains(space.id) else { return nil }
      guard seenSpaceIDs.insert(space.id).inserted else { return nil }
      return space.pruned()
    }
    guard !spaces.isEmpty else { return nil }
    let resolvedSelectedSpaceID =
      spaces.contains(where: { $0.id == self.selectedSpaceID })
      ? self.selectedSpaceID
      : spaces[0].id
    return TerminalWindowSession(
      selectedSpaceID: resolvedSelectedSpaceID,
      spaces: spaces
    )
  }
}

nonisolated struct TerminalWindowSpaceSession: Equatable, Codable, Sendable {
  var id: TerminalSpaceID
  var selectedTabID: TerminalTabID?
  var tabs: [TerminalTabSession]

  func pruned() -> TerminalWindowSpaceSession {
    var seenTabIDs: Set<TerminalTabID> = []
    let tabs = tabs.compactMap { tab -> TerminalTabSession? in
      guard seenTabIDs.insert(tab.id).inserted else { return nil }
      return tab.pruned()
    }
    let resolvedSelectedTabID =
      self.selectedTabID.flatMap { id in
        tabs.contains(where: { $0.id == id }) ? id : nil
      }
      ?? tabs.first?.id
    return TerminalWindowSpaceSession(
      id: id,
      selectedTabID: resolvedSelectedTabID,
      tabs: tabs
    )
  }
}

nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  var id: TerminalTabID
  var title: String
  var isPinned: Bool
  var isTitleLocked: Bool
  var focusedPaneID: UUID?
  var root: TerminalPaneNodeSession

  func pruned() -> TerminalTabSession? {
    guard let root = root.pruned() else { return nil }
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return TerminalTabSession(
      id: id,
      title: title.isEmpty ? "Terminal" : title,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked,
      focusedPaneID: root.containsLeaf(id: focusedPaneID) ? focusedPaneID : root.leftmostLeafID,
      root: root
    )
  }
}

nonisolated indirect enum TerminalPaneNodeSession: Equatable, Codable, Sendable {
  case leaf(TerminalPaneLeafSession)
  case split(TerminalPaneSplitSession)

  private enum CodingKeys: String, CodingKey {
    case kind
    case leaf
    case split
  }

  private enum Kind: String, Codable {
    case leaf
    case split
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .leaf:
      self = .leaf(try container.decode(TerminalPaneLeafSession.self, forKey: .leaf))
    case .split:
      self = .split(try container.decode(TerminalPaneSplitSession.self, forKey: .split))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .leaf(let leaf):
      try container.encode(Kind.leaf, forKey: .kind)
      try container.encode(leaf, forKey: .leaf)
    case .split(let split):
      try container.encode(Kind.split, forKey: .kind)
      try container.encode(split, forKey: .split)
    }
  }

  var leftmostLeafID: UUID {
    switch self {
    case .leaf(let leaf):
      return leaf.id
    case .split(let split):
      return split.left.leftmostLeafID
    }
  }

  func containsLeaf(id: UUID?) -> Bool {
    guard let id else { return false }
    switch self {
    case .leaf(let leaf):
      return leaf.id == id
    case .split(let split):
      return split.left.containsLeaf(id: id) || split.right.containsLeaf(id: id)
    }
  }

  func pruned() -> TerminalPaneNodeSession? {
    switch self {
    case .leaf(let leaf):
      return .leaf(leaf.pruned())
    case .split(let split):
      return split.pruned()
    }
  }
}

nonisolated struct TerminalPaneLeafSession: Equatable, Codable, Sendable {
  var id: UUID
  var workingDirectoryPath: String?

  func pruned() -> TerminalPaneLeafSession {
    let workingDirectoryPath =
      workingDirectoryPath?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return TerminalPaneLeafSession(
      id: id,
      workingDirectoryPath: workingDirectoryPath?.isEmpty == true ? nil : workingDirectoryPath
    )
  }
}

nonisolated struct TerminalPaneSplitSession: Equatable, Codable, Sendable {
  var direction: TerminalPaneSplitDirection
  var ratio: Double
  var left: TerminalPaneNodeSession
  var right: TerminalPaneNodeSession

  func pruned() -> TerminalPaneNodeSession? {
    let left = left.pruned()
    let right = right.pruned()
    switch (left, right) {
    case (.some(let left), .some(let right)):
      return .split(
        TerminalPaneSplitSession(
          direction: direction,
          ratio: Self.sanitizedRatio(ratio),
          left: left,
          right: right
        )
      )
    case (.some(let left), .none):
      return left
    case (.none, .some(let right)):
      return right
    case (.none, .none):
      return nil
    }
  }

  private static func sanitizedRatio(_ ratio: Double) -> Double {
    guard ratio > 0, ratio < 1 else { return 0.5 }
    return ratio
  }
}

nonisolated enum TerminalPaneSplitDirection: String, Equatable, Codable, Sendable {
  case horizontal
  case vertical
}
