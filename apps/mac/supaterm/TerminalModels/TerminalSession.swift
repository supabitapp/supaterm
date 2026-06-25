import CoreGraphics
import CryptoKit
import Foundation
import SupatermCLIShared

public nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  public static let currentVersion = 4
  public static let `default` = Self(windows: [])

  public let version: Int
  public var windows: [TerminalWindowSession]

  public init(
    version: Int = Self.currentVersion,
    windows: [TerminalWindowSession]
  ) {
    self.version = version
    self.windows = windows
  }

  public init(from decoder: Decoder) throws {
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

  public static func defaultURL(
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

  public var surfaceIDs: Set<UUID> {
    windows.reduce(into: Set<UUID>()) { result, window in
      result.formUnion(window.surfaceIDs)
    }
  }
}

public nonisolated struct TerminalWindowSession: Equatable, Codable, Sendable {
  public var selectedSpaceID: TerminalSpaceID
  public var spaces: [TerminalWindowSpaceSession]
  public var frame: TerminalWindowFrame?

  public init(
    selectedSpaceID: TerminalSpaceID,
    spaces: [TerminalWindowSpaceSession],
    frame: TerminalWindowFrame? = nil
  ) {
    self.selectedSpaceID = selectedSpaceID
    self.spaces = spaces
    self.frame = frame
  }

  public func pruned(validSpaceIDs: Set<TerminalSpaceID>) -> TerminalWindowSession? {
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

  public var surfaceIDs: Set<UUID> {
    spaces.reduce(into: Set<UUID>()) { result, space in
      result.formUnion(space.surfaceIDs)
    }
  }
}

public nonisolated struct TerminalWindowFrame: Equatable, Codable, Sendable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(
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

  public init(_ rect: CGRect) {
    self.init(
      x: Double(rect.origin.x),
      y: Double(rect.origin.y),
      width: Double(rect.size.width),
      height: Double(rect.size.height)
    )
  }

  public var rect: CGRect {
    CGRect(x: x, y: y, width: width, height: height)
  }
}

public nonisolated struct TerminalWindowSpaceSession: Equatable, Codable, Sendable {
  public var id: TerminalSpaceID
  public var selectedTabIndex: Int?
  public var selectedPinnedTabID: TerminalTabID?
  public var tabs: [TerminalTabSession]

  public init(
    id: TerminalSpaceID,
    selectedTabIndex: Int?,
    selectedPinnedTabID: TerminalTabID? = nil,
    tabs: [TerminalTabSession]
  ) {
    self.id = id
    self.selectedTabIndex = selectedTabIndex
    self.selectedPinnedTabID = selectedPinnedTabID
    self.tabs = tabs
  }

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

  public var surfaceIDs: Set<UUID> {
    tabs.reduce(into: Set<UUID>()) { result, tab in
      result.formUnion(tab.surfaceIDs)
    }
  }
}

public nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  public var isPinned: Bool
  public var lockedTitle: String?
  public var focusedPaneIndex: Int
  public var root: TerminalPaneNodeSession

  public init(
    isPinned: Bool,
    lockedTitle: String?,
    focusedPaneIndex: Int,
    root: TerminalPaneNodeSession
  ) {
    self.isPinned = isPinned
    self.lockedTitle = lockedTitle
    self.focusedPaneIndex = focusedPaneIndex
    self.root = root
  }

  public func pruned() -> TerminalTabSession? {
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

  public func updatingWorkingDirectoryPaths(
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

  public var surfaceIDs: Set<UUID> {
    root.surfaceIDs
  }
}

public nonisolated indirect enum TerminalPaneNodeSession: Equatable, Codable, Sendable {
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

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .leaf:
      self = .leaf(try container.decode(TerminalPaneLeafSession.self, forKey: .leaf))
    case .split:
      self = .split(try container.decode(TerminalPaneSplitSession.self, forKey: .split))
    }
  }

  public func encode(to encoder: Encoder) throws {
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

  public var leafCount: Int {
    switch self {
    case .leaf:
      return 1
    case .split(let split):
      return split.left.leafCount + split.right.leafCount
    }
  }

  public var surfaceIDs: Set<UUID> {
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

public nonisolated struct TerminalPaneLeafSession: Equatable, Codable, Sendable {
  public var id: UUID
  public var workingDirectoryPath: String?
  public var titleOverride: String?
  public var agents: [TerminalPaneAgentRecord]

  private enum CodingKeys: String, CodingKey {
    case id
    case workingDirectoryPath
    case titleOverride
    case agents
  }

  public init(
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

  public init(from decoder: Decoder) throws {
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

public nonisolated enum TerminalPaneAgentActivityPhase: String, Codable, Equatable, Sendable {
  case idle
  case needsInput = "needs_input"
  case running
}

public nonisolated struct TerminalPaneAgentRecord: Equatable, Codable, Sendable {
  public var agent: SupatermAgentKind
  public var sessionIDs: [String]
  public var processIDs: [Int32]
  public var activityPhase: TerminalPaneAgentActivityPhase?

  public init(
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

  public func pruned() -> Self? {
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

public nonisolated struct TerminalPaneSplitSession: Equatable, Codable, Sendable {
  public var direction: TerminalPaneSplitDirection
  public var ratio: Double
  public var left: TerminalPaneNodeSession
  public var right: TerminalPaneNodeSession

  public init(
    direction: TerminalPaneSplitDirection,
    ratio: Double,
    left: TerminalPaneNodeSession,
    right: TerminalPaneNodeSession
  ) {
    self.direction = direction
    self.ratio = ratio
    self.left = left
    self.right = right
  }

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

public nonisolated enum TerminalPaneSplitDirection: String, Equatable, Codable, Sendable {
  case horizontal
  case vertical
}
