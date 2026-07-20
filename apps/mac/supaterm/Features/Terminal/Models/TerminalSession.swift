import CoreGraphics
import Foundation
import SupatermCLIShared

nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 6
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
  var collapsedGroupIDs: [TerminalTabGroupID]
  var rootItems: [TerminalTabRootSessionItem]

  func pruned() -> TerminalWindowSpaceSession {
    let selectedTabSurfaceIDs = selectedTabIndex.flatMap { index in
      let tabs = self.rootItems.flatMap(\.tabs)
      return tabs.indices.contains(index) ? tabs[index].surfaceIDs : nil
    }
    var seenGroupIDs: Set<TerminalTabGroupID> = []
    let rootItems = rootItems.compactMap { item -> TerminalTabRootSessionItem? in
      guard let item = item.pruned() else { return nil }
      if case .group(let id, _, _, _, _) = item {
        guard seenGroupIDs.insert(id).inserted else { return nil }
      }
      return item
    }
    let normalizedRootItems =
      rootItems.filter(\.isPinned) + rootItems.filter { !$0.isPinned }
    let survivingGroupIDs = Set(normalizedRootItems.compactMap(\.groupID))
    var seenCollapsedGroupIDs: Set<TerminalTabGroupID> = []
    let collapsedGroupIDs = collapsedGroupIDs.filter {
      survivingGroupIDs.contains($0) && seenCollapsedGroupIDs.insert($0).inserted
    }
    let resolvedSelectedTabIndex = Self.resolvedSelectedTabIndex(
      selectedTabSurfaceIDs,
      tabs: normalizedRootItems.flatMap(\.tabs)
    )
    return TerminalWindowSpaceSession(
      id: id,
      selectedTabIndex: resolvedSelectedTabIndex,
      collapsedGroupIDs: collapsedGroupIDs,
      rootItems: normalizedRootItems
    )
  }

  private static func resolvedSelectedTabIndex(
    _ selectedTabSurfaceIDs: Set<UUID>?,
    tabs: [TerminalTabSession]
  ) -> Int? {
    guard !tabs.isEmpty else { return nil }
    guard let selectedTabSurfaceIDs else { return 0 }
    return tabs.firstIndex { $0.surfaceIDs == selectedTabSurfaceIDs } ?? 0
  }

  var surfaceIDs: Set<UUID> {
    rootItems.reduce(into: Set<UUID>()) { result, item in
      result.formUnion(item.surfaceIDs)
    }
  }
}

nonisolated enum TerminalTabRootSessionItem: Equatable, Codable, Sendable {
  case tab(isPinned: Bool, tab: TerminalTabSession)
  case group(
    id: TerminalTabGroupID,
    title: String,
    color: TerminalTabGroupColor,
    isPinned: Bool,
    tabs: [TerminalTabSession]
  )

  private enum CodingKeys: String, CodingKey {
    case kind
    case isPinned
    case tab
    case id
    case title
    case color
    case tabs
  }

  private enum Kind: String, Codable {
    case tab
    case group
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .tab:
      self = .tab(
        isPinned: try container.decode(Bool.self, forKey: .isPinned),
        tab: try container.decode(TerminalTabSession.self, forKey: .tab)
      )
    case .group:
      self = .group(
        id: try container.decode(TerminalTabGroupID.self, forKey: .id),
        title: try container.decode(String.self, forKey: .title),
        color: try container.decode(TerminalTabGroupColor.self, forKey: .color),
        isPinned: try container.decode(Bool.self, forKey: .isPinned),
        tabs: try container.decode([TerminalTabSession].self, forKey: .tabs)
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .tab(let isPinned, let tab):
      try container.encode(Kind.tab, forKey: .kind)
      try container.encode(isPinned, forKey: .isPinned)
      try container.encode(tab, forKey: .tab)
    case .group(let id, let title, let color, let isPinned, let tabs):
      try container.encode(Kind.group, forKey: .kind)
      try container.encode(id, forKey: .id)
      try container.encode(title, forKey: .title)
      try container.encode(color, forKey: .color)
      try container.encode(isPinned, forKey: .isPinned)
      try container.encode(tabs, forKey: .tabs)
    }
  }

  var isPinned: Bool {
    switch self {
    case .tab(let isPinned, _), .group(_, _, _, let isPinned, _):
      return isPinned
    }
  }

  var tabs: [TerminalTabSession] {
    switch self {
    case .tab(_, let tab):
      return [tab]
    case .group(_, _, _, _, let tabs):
      return tabs
    }
  }

  var groupID: TerminalTabGroupID? {
    guard case .group(let id, _, _, _, _) = self else { return nil }
    return id
  }

  var surfaceIDs: Set<UUID> {
    tabs.reduce(into: Set<UUID>()) { result, tab in
      result.formUnion(tab.surfaceIDs)
    }
  }

  func pruned() -> TerminalTabRootSessionItem? {
    switch self {
    case .tab(let isPinned, let tab):
      guard let tab = tab.pruned() else { return nil }
      return .tab(isPinned: isPinned, tab: tab)
    case .group(let id, let title, let color, let isPinned, let tabs):
      let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
      return .group(
        id: id,
        title: normalizedTitle.isEmpty ? "Group" : normalizedTitle,
        color: color,
        isPinned: isPinned,
        tabs: tabs.compactMap { $0.pruned() }
      )
    }
  }
}

nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  var lockedTitle: String?
  var focusedPaneIndex: Int
  var root: TerminalPaneNodeSession

  func pruned() -> TerminalTabSession? {
    guard let root = root.pruned() else { return nil }
    return TerminalTabSession(
      lockedTitle: lockedTitle?.isEmpty == true ? nil : lockedTitle,
      focusedPaneIndex: Self.resolvedFocusedPaneIndex(
        focusedPaneIndex,
        leafCount: root.leafCount
      ),
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
  var titleOverride: String?
  var agents: [TerminalPaneAgentRecord]

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

nonisolated struct TerminalPaneAgentRecord: Equatable, Codable, Sendable {
  let agent: SupatermAgentKind
  let sessionID: String
  let processes: [TerminalAgentProcessIdentity]
  let transcriptPath: String?
  let turnLifecycle: TerminalAgentTurnLifecycle
  let phase: AgentActivityPhase
  let detail: String?
  let attentionRequestID: String?
  let hoverMessages: [String]
  let nativePlanRows: [PaneAgentProgressRow]
  let transcriptRows: [PaneAgentProgressRow]
  let activeChildren: [TerminalAgentActiveChild]
  let isForeground: Bool
  let revision: Int
  let workingDirectoryPath: String?

  init(
    agent: SupatermAgentKind,
    sessionID: String,
    processes: [TerminalAgentProcessIdentity],
    transcriptPath: String? = nil,
    turnLifecycle: TerminalAgentTurnLifecycle = .unseen,
    phase: AgentActivityPhase = .idle,
    detail: String? = nil,
    attentionRequestID: String? = nil,
    hoverMessages: [String] = [],
    nativePlanRows: [PaneAgentProgressRow] = [],
    transcriptRows: [PaneAgentProgressRow] = [],
    activeChildren: [TerminalAgentActiveChild] = [],
    isForeground: Bool = false,
    revision: Int = 0,
    workingDirectoryPath: String? = nil
  ) {
    self.agent = agent
    self.sessionID = sessionID
    self.processes = processes
    self.transcriptPath = transcriptPath
    self.turnLifecycle = turnLifecycle
    self.phase = phase
    self.detail = detail
    self.attentionRequestID = attentionRequestID
    self.hoverMessages = hoverMessages
    self.nativePlanRows = nativePlanRows
    self.transcriptRows = transcriptRows
    self.activeChildren = activeChildren
    self.isForeground = isForeground
    self.revision = revision
    self.workingDirectoryPath = workingDirectoryPath
  }

  init(snapshot: TerminalAgentStateSnapshot) {
    self.init(
      agent: snapshot.agent,
      sessionID: snapshot.sessionID,
      processes: Array(snapshot.processes),
      transcriptPath: snapshot.transcriptPath,
      turnLifecycle: snapshot.turnLifecycle,
      phase: snapshot.phase,
      detail: snapshot.detail,
      attentionRequestID: snapshot.attentionRequestID,
      hoverMessages: snapshot.hoverMessages,
      nativePlanRows: snapshot.progressRowsBySource[.nativePlan] ?? [],
      transcriptRows: snapshot.progressRowsBySource[.transcript] ?? [],
      activeChildren: snapshot.activeChildren,
      isForeground: snapshot.isForeground,
      revision: snapshot.revision,
      workingDirectoryPath: snapshot.workingDirectoryPath
    )
  }

  func snapshot(
    surfaceID: UUID,
    processes: Set<TerminalAgentProcessIdentity>
  ) -> TerminalAgentStateSnapshot {
    var progressRowsBySource: [TerminalAgentEvent.ProgressSource: [PaneAgentProgressRow]] = [:]
    if !nativePlanRows.isEmpty {
      progressRowsBySource[.nativePlan] = nativePlanRows
    }
    if !transcriptRows.isEmpty {
      progressRowsBySource[.transcript] = transcriptRows
    }
    return TerminalAgentStateSnapshot(
      agent: agent,
      sessionID: sessionID,
      surfaceID: surfaceID,
      processes: processes,
      transcriptPath: transcriptPath,
      turnLifecycle: turnLifecycle,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      hoverMessages: hoverMessages,
      isActionable: false,
      progressRowsBySource: progressRowsBySource,
      activeChildren: activeChildren,
      isForeground: isForeground,
      revision: revision,
      workingDirectoryPath: workingDirectoryPath
    )
  }

  func pruned() -> Self? {
    let sessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
    let processes = Array(Set(processes)).sorted {
      ($0.processID, $0.startTimeMicroseconds) < ($1.processID, $1.startTimeMicroseconds)
    }
    guard !sessionID.isEmpty, !processes.isEmpty else { return nil }
    return Self(
      agent: agent,
      sessionID: sessionID,
      processes: processes,
      transcriptPath: transcriptPath,
      turnLifecycle: turnLifecycle,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      hoverMessages: hoverMessages,
      nativePlanRows: nativePlanRows,
      transcriptRows: transcriptRows,
      activeChildren: activeChildren,
      isForeground: isForeground,
      revision: max(0, revision),
      workingDirectoryPath: workingDirectoryPath
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
