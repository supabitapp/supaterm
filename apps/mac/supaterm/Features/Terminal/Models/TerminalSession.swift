import CoreGraphics
import CryptoKit
import Foundation
import SupatermCLIShared

nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 4
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
    guard version == Self.currentVersion || version == 3 else {
      throw DecodingError.dataCorruptedError(
        forKey: .version,
        in: container,
        debugDescription: "Unsupported session version: \(version)"
      )
    }
    self.version = Self.currentVersion
    self.windows = try container.decode([TerminalWindowSession].self, forKey: .windows)
  }

  static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "session.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  var surfaceIDs: Set<UUID> {
    windows.reduce(into: Set<UUID>()) { result, window in
      result.formUnion(window.surfaceIDs)
    }
  }
}

nonisolated struct TerminalWindowSession: Equatable, Codable, Sendable {
  var selectedSpaceID: TerminalSpaceID
  var spaces: [TerminalWindowSpaceSession]
  var frame: TerminalWindowFrame?

  init(
    selectedSpaceID: TerminalSpaceID,
    spaces: [TerminalWindowSpaceSession],
    frame: TerminalWindowFrame? = nil
  ) {
    self.selectedSpaceID = selectedSpaceID
    self.spaces = spaces
    self.frame = frame
  }

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
      spaces: spaces,
      frame: frame
    )
  }

  var surfaceIDs: Set<UUID> {
    spaces.reduce(into: Set<UUID>()) { result, space in
      result.formUnion(space.surfaceIDs)
    }
  }
}

nonisolated struct TerminalWindowFrame: Equatable, Codable, Sendable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double

  init(
    x: Double,
    y: Double,
    width: Double,
    height: Double
  ) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }

  init(_ rect: CGRect) {
    self.init(
      x: Double(rect.origin.x),
      y: Double(rect.origin.y),
      width: Double(rect.size.width),
      height: Double(rect.size.height)
    )
  }

  var rect: CGRect {
    CGRect(x: x, y: y, width: width, height: height)
  }
}

nonisolated struct TerminalWindowSpaceSession: Equatable, Codable, Sendable {
  var id: TerminalSpaceID
  var selectedTabIndex: Int?
  var selectedPinnedTabID: TerminalTabID?
  var tabs: [TerminalTabSession]

  func pruned() -> TerminalWindowSpaceSession {
    let tabs = tabs.compactMap { $0.pruned() }
    let resolvedSelectedTabIndex = Self.resolvedSelectedTabIndex(
      selectedTabIndex,
      tabCount: tabs.count
    )
    return TerminalWindowSpaceSession(
      id: id,
      selectedTabIndex: resolvedSelectedTabIndex,
      selectedPinnedTabID: selectedPinnedTabID,
      tabs: tabs
    )
  }

  private static func resolvedSelectedTabIndex(
    _ selectedTabIndex: Int?,
    tabCount: Int
  ) -> Int? {
    guard tabCount > 0 else { return nil }
    guard let selectedTabIndex, (0..<tabCount).contains(selectedTabIndex) else {
      return 0
    }
    return selectedTabIndex
  }

  var surfaceIDs: Set<UUID> {
    tabs.reduce(into: Set<UUID>()) { result, tab in
      result.formUnion(tab.surfaceIDs)
    }
  }
}

nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  var isPinned: Bool
  var lockedTitle: String?
  var focusedPaneIndex: Int
  var root: TerminalPaneNodeSession

  func pruned() -> TerminalTabSession? {
    guard let root = root.pruned() else { return nil }
    return TerminalTabSession(
      isPinned: isPinned,
      lockedTitle: lockedTitle?.isEmpty == true ? nil : lockedTitle,
      focusedPaneIndex: Self.resolvedFocusedPaneIndex(
        focusedPaneIndex,
        leafCount: root.leafCount
      ),
      root: root
    )
  }

  func updatingWorkingDirectoryPaths(
    _ workingDirectoryPaths: [String?],
    focusedPaneIndex: Int
  ) -> TerminalTabSession {
    guard root.leafCount > 0 else { return self }
    guard workingDirectoryPaths.count >= root.leafCount else { return self }
    let resolvedFocusedPaneIndex = min(max(focusedPaneIndex, 0), root.leafCount - 1)
    let focusedWorkingDirectoryPath =
      workingDirectoryPaths.indices.contains(focusedPaneIndex)
      ? workingDirectoryPaths[focusedPaneIndex]
      : workingDirectoryPaths.first.flatMap { $0 }
    let updatesAllLeafPaths = root.leafCount == workingDirectoryPaths.count
    let root =
      root.updatingLeaves { index, leaf in
        var leaf = leaf
        if updatesAllLeafPaths {
          leaf.workingDirectoryPath = workingDirectoryPaths[index]
        } else if index == resolvedFocusedPaneIndex {
          leaf.workingDirectoryPath = focusedWorkingDirectoryPath
        }
        return leaf
      }
    return TerminalTabSession(
      isPinned: isPinned,
      lockedTitle: lockedTitle,
      focusedPaneIndex: resolvedFocusedPaneIndex,
      root: root
    )
  }

  private static func resolvedFocusedPaneIndex(
    _ focusedPaneIndex: Int,
    leafCount: Int
  ) -> Int {
    guard (0..<leafCount).contains(focusedPaneIndex) else { return 0 }
    return focusedPaneIndex
  }

  var surfaceIDs: Set<UUID> {
    root.surfaceIDs
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

  var leafCount: Int {
    switch self {
    case .leaf:
      return 1
    case .split(let split):
      return split.left.leafCount + split.right.leafCount
    }
  }

  var surfaceIDs: Set<UUID> {
    switch self {
    case .leaf(let leaf):
      return [leaf.id]
    case .split(let split):
      return split.left.surfaceIDs.union(split.right.surfaceIDs)
    }
  }

  fileprivate func updatingLeaves(
    _ update: (Int, TerminalPaneLeafSession) -> TerminalPaneLeafSession
  ) -> TerminalPaneNodeSession {
    var index = 0
    return updatingLeaves(update, index: &index)
  }

  func pruned() -> TerminalPaneNodeSession? {
    switch self {
    case .leaf(let leaf):
      return .leaf(leaf.pruned())
    case .split(let split):
      return split.pruned()
    }
  }

  private func updatingLeaves(
    _ update: (Int, TerminalPaneLeafSession) -> TerminalPaneLeafSession,
    index: inout Int
  ) -> TerminalPaneNodeSession {
    switch self {
    case .leaf(let leaf):
      let leaf = update(index, leaf)
      index += 1
      return .leaf(leaf)

    case .split(let split):
      let left = split.left.updatingLeaves(
        update,
        index: &index
      )
      let right = split.right.updatingLeaves(
        update,
        index: &index
      )
      return .split(
        TerminalPaneSplitSession(
          direction: split.direction,
          ratio: split.ratio,
          left: left,
          right: right
        )
      )
    }
  }
}

nonisolated struct TerminalPaneLeafSession: Equatable, Codable, Sendable {
  var id: UUID
  var workingDirectoryPath: String?
  var titleOverride: String?
  var agents: [TerminalPaneAgentRecord]

  private enum CodingKeys: String, CodingKey {
    case id
    case workingDirectoryPath
    case titleOverride
    case agents
  }

  init(
    id: UUID = UUID(),
    workingDirectoryPath: String?,
    titleOverride: String? = nil,
    agents: [TerminalPaneAgentRecord] = []
  ) {
    self.id = id
    self.workingDirectoryPath = workingDirectoryPath
    self.titleOverride = titleOverride
    self.agents = agents
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? Self.legacyID(codingPath: decoder.codingPath)
    self.workingDirectoryPath = try container.decodeIfPresent(String.self, forKey: .workingDirectoryPath)
    self.titleOverride = try container.decodeIfPresent(String.self, forKey: .titleOverride)
    self.agents = try container.decodeIfPresent([TerminalPaneAgentRecord].self, forKey: .agents) ?? []
  }

  private static func legacyID(codingPath: [CodingKey]) -> UUID {
    let seed = codingPath.map { key in
      key.intValue.map { "[\($0)]" } ?? key.stringValue
    }
    .joined(separator: "/")
    let digest = SHA256.hash(data: Data((seed.isEmpty ? "leaf" : seed).utf8))
    let bytes = Array(digest.prefix(16))
    return UUID(
      uuid: (
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
      ))
  }

  func pruned() -> TerminalPaneLeafSession {
    let workingDirectoryPath =
      workingDirectoryPath?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return TerminalPaneLeafSession(
      id: id,
      workingDirectoryPath: workingDirectoryPath?.isEmpty == true ? nil : workingDirectoryPath,
      titleOverride: titleOverride?.isEmpty == true ? nil : titleOverride,
      agents: agents.compactMap { $0.pruned() }
    )
  }
}

nonisolated enum TerminalPaneAgentActivityPhase: String, Codable, Equatable, Sendable {
  case idle
  case needsInput = "needs_input"
  case running
}

nonisolated struct TerminalPaneAgentRecord: Equatable, Codable, Sendable {
  var agent: SupatermAgentKind
  var sessionIDs: [String]
  var processIDs: [Int32]
  var activityPhase: TerminalPaneAgentActivityPhase?

  init(
    agent: SupatermAgentKind,
    sessionIDs: [String] = [],
    processIDs: [Int32] = [],
    activityPhase: TerminalPaneAgentActivityPhase? = nil
  ) {
    self.agent = agent
    self.sessionIDs = Self.normalizedSessionIDs(sessionIDs)
    self.processIDs = Self.normalizedProcessIDs(processIDs)
    self.activityPhase = activityPhase
  }

  func pruned() -> Self? {
    let sessionIDs = Self.normalizedSessionIDs(sessionIDs)
    let processIDs = Self.normalizedProcessIDs(processIDs)
    guard !sessionIDs.isEmpty || !processIDs.isEmpty || activityPhase != nil else { return nil }
    return Self(
      agent: agent,
      sessionIDs: sessionIDs,
      processIDs: processIDs,
      activityPhase: activityPhase
    )
  }

  private static func normalizedSessionIDs(_ sessionIDs: [String]) -> [String] {
    Array(
      Set(
        sessionIDs.compactMap { sessionID in
          let sessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
          return sessionID.isEmpty ? nil : sessionID
        }
      )
    )
    .sorted()
  }

  private static func normalizedProcessIDs(_ processIDs: [Int32]) -> [Int32] {
    Array(Set(processIDs.filter { $0 > 0 })).sorted()
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
