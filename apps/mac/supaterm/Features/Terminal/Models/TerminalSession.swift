import CoreGraphics
import Foundation
import SupatermCLIShared

nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 7
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

  func pruned(validSpaceIDs: Set<TerminalSpaceID>) -> Self {
    var seenTabIDs: Set<TerminalTabID> = []
    var seenGroupIDs: Set<TerminalTabGroupID> = []
    var seenSurfaceIDs: Set<UUID> = []
    return Self(
      windows: windows.compactMap {
        $0.pruned(
          validSpaceIDs: validSpaceIDs,
          seenTabIDs: &seenTabIDs,
          seenGroupIDs: &seenGroupIDs,
          seenSurfaceIDs: &seenSurfaceIDs
        )
      }
    )
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
    var seenTabIDs: Set<TerminalTabID> = []
    var seenGroupIDs: Set<TerminalTabGroupID> = []
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(
      validSpaceIDs: validSpaceIDs,
      seenTabIDs: &seenTabIDs,
      seenGroupIDs: &seenGroupIDs,
      seenSurfaceIDs: &seenSurfaceIDs
    )
  }

  fileprivate func pruned(
    validSpaceIDs: Set<TerminalSpaceID>,
    seenTabIDs: inout Set<TerminalTabID>,
    seenGroupIDs: inout Set<TerminalTabGroupID>,
    seenSurfaceIDs: inout Set<UUID>
  ) -> TerminalWindowSession? {
    var seenSpaceIDs: Set<TerminalSpaceID> = []
    let spaces = spaces.compactMap { space -> TerminalWindowSpaceSession? in
      guard validSpaceIDs.contains(space.id) else { return nil }
      guard seenSpaceIDs.insert(space.id).inserted else { return nil }
      let space = space.pruned(
        excludingTabIDs: seenTabIDs,
        excludingGroupIDs: seenGroupIDs,
        seenSurfaceIDs: &seenSurfaceIDs
      )
      seenTabIDs.formUnion(space.tabs.map(\.id))
      seenGroupIDs.formUnion(space.groups.map(\.id))
      return space
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
  var selectedTabID: TerminalTabID?
  var nodes: [TerminalTabNodeSession]
  var groups: [TerminalTabGroupSession]
  var collapsedGroupIDs: [TerminalTabGroupID]
  var tabs: [TerminalTabSession]

  func pruned() -> TerminalWindowSpaceSession {
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(
      excludingTabIDs: [],
      excludingGroupIDs: [],
      seenSurfaceIDs: &seenSurfaceIDs
    )
  }

  fileprivate func pruned(
    excludingTabIDs: Set<TerminalTabID>,
    excludingGroupIDs: Set<TerminalTabGroupID>,
    seenSurfaceIDs: inout Set<UUID>
  ) -> TerminalWindowSpaceSession {
    let tabSessionsByID = uniqueTabSessions(excluding: excludingTabIDs)
    let groupSessionsByID = uniqueGroupSessions(excluding: excludingGroupIDs)
    let indexedGroupNodes = indexedGroupNodes(groupSessionsByID: groupSessionsByID)
    let groupNodeIDs = Set(indexedGroupNodes.compactMap { $0.node.item.groupID })
    let indexedTabNodes = indexedTabNodes(
      tabSessionsByID: tabSessionsByID,
      groupNodeIDs: groupNodeIDs
    )

    var tabNodesByGroupID: [TerminalTabGroupID: [IndexedTerminalTabNode]] = [:]
    for indexedNode in indexedTabNodes {
      guard let groupID = indexedNode.node.parent.groupID else { continue }
      tabNodesByGroupID[groupID, default: []].append(indexedNode)
    }
    let orderedTabNodesByGroupID = tabNodesByGroupID.mapValues(Self.ordered)
    let candidateRootNodes = Self.orderedRootNodes(indexedGroupNodes + indexedTabNodes)
      .filter { indexedNode in
        guard case .group(let groupID) = indexedNode.node.item else { return true }
        guard let group = groupSessionsByID[groupID] else { return false }
        return group.lifetime == .durable || orderedTabNodesByGroupID[groupID]?.isEmpty == false
      }

    let candidateTabIDs = candidateRootNodes.flatMap { indexedNode -> [TerminalTabID] in
      switch indexedNode.node.item {
      case .tab(let tabID):
        return [tabID]
      case .group(let groupID):
        return orderedTabNodesByGroupID[groupID]?.compactMap(\.node.item.tabID) ?? []
      }
    }
    var resolvedTabSessionsByID: [TerminalTabID: TerminalTabSession] = [:]
    for tabID in candidateTabIDs {
      guard
        let tab = tabSessionsByID[tabID]?.pruned(seenSurfaceIDs: &seenSurfaceIDs)
      else { continue }
      resolvedTabSessionsByID[tabID] = tab
    }

    let resolvedTabNodesByGroupID = orderedTabNodesByGroupID.mapValues { nodes in
      nodes.filter { indexedNode in
        indexedNode.node.item.tabID.flatMap { resolvedTabSessionsByID[$0] } != nil
      }
    }
    let resolvedRootNodes = candidateRootNodes.filter { indexedNode in
      switch indexedNode.node.item {
      case .tab(let tabID):
        return resolvedTabSessionsByID[tabID] != nil
      case .group(let groupID):
        guard let group = groupSessionsByID[groupID] else { return false }
        return group.lifetime == .durable || resolvedTabNodesByGroupID[groupID]?.isEmpty == false
      }
    }
    let topology = Self.reindexedTopology(
      pinnedRootNodes: resolvedRootNodes.filter { $0.node.parent.isPinned == true },
      regularRootNodes: resolvedRootNodes.filter { $0.node.parent.isPinned == false },
      tabNodesByGroupID: resolvedTabNodesByGroupID
    )
    let resolvedGroups = topology.rootGroupIDs.compactMap { groupSessionsByID[$0] }
    let resolvedTabs = topology.tabIDs.compactMap { resolvedTabSessionsByID[$0] }
    let resolvedTabIDs = Set(topology.tabIDs)
    let selectedTabID =
      selectedTabID.flatMap { resolvedTabIDs.contains($0) ? $0 : nil }
      ?? topology.tabIDs.first
    let collapsedGroupIDSet = Set(collapsedGroupIDs)
    return TerminalWindowSpaceSession(
      id: id,
      selectedTabID: selectedTabID,
      nodes: topology.nodes,
      groups: resolvedGroups,
      collapsedGroupIDs: topology.rootGroupIDs.filter(collapsedGroupIDSet.contains),
      tabs: resolvedTabs
    )
  }

  private func uniqueTabSessions(
    excluding excludedIDs: Set<TerminalTabID>
  ) -> [TerminalTabID: TerminalTabSession] {
    var sessionsByID: [TerminalTabID: TerminalTabSession] = [:]
    for session in tabs where !excludedIDs.contains(session.id) && sessionsByID[session.id] == nil {
      sessionsByID[session.id] = session
    }
    return sessionsByID
  }

  private func uniqueGroupSessions(
    excluding excludedIDs: Set<TerminalTabGroupID>
  ) -> [TerminalTabGroupID: TerminalTabGroupSession] {
    var sessionsByID: [TerminalTabGroupID: TerminalTabGroupSession] = [:]
    for session in groups
    where !excludedIDs.contains(session.id) && sessionsByID[session.id] == nil {
      sessionsByID[session.id] = session.pruned()
    }
    return sessionsByID
  }

  private func indexedGroupNodes(
    groupSessionsByID: [TerminalTabGroupID: TerminalTabGroupSession]
  ) -> [IndexedTerminalTabNode] {
    var seenIDs: Set<TerminalTabGroupID> = []
    return nodes.enumerated().compactMap { sourceIndex, node in
      guard
        case .group(let groupID) = node.item,
        case .root = node.parent,
        groupSessionsByID[groupID] != nil,
        seenIDs.insert(groupID).inserted
      else { return nil }
      return IndexedTerminalTabNode(sourceIndex: sourceIndex, node: node)
    }
  }

  private func indexedTabNodes(
    tabSessionsByID: [TerminalTabID: TerminalTabSession],
    groupNodeIDs: Set<TerminalTabGroupID>
  ) -> [IndexedTerminalTabNode] {
    var seenIDs: Set<TerminalTabID> = []
    return nodes.enumerated().compactMap { sourceIndex, node in
      guard
        case .tab(let tabID) = node.item,
        tabSessionsByID[tabID] != nil
      else { return nil }
      if case .group(let groupID) = node.parent, !groupNodeIDs.contains(groupID) {
        return nil
      }
      guard seenIDs.insert(tabID).inserted else { return nil }
      return IndexedTerminalTabNode(sourceIndex: sourceIndex, node: node)
    }
  }

  private static func ordered(
    _ nodes: [IndexedTerminalTabNode]
  ) -> [IndexedTerminalTabNode] {
    nodes.sorted {
      ($0.node.order, $0.sourceIndex) < ($1.node.order, $1.sourceIndex)
    }
  }

  private static func orderedRootNodes(
    _ nodes: [IndexedTerminalTabNode]
  ) -> [IndexedTerminalTabNode] {
    let rootNodes = nodes.filter { $0.node.parent.isPinned != nil }
    return ordered(rootNodes.filter { $0.node.parent.isPinned == true })
      + ordered(rootNodes.filter { $0.node.parent.isPinned == false })
  }

  private static func reindexedTopology(
    pinnedRootNodes: [IndexedTerminalTabNode],
    regularRootNodes: [IndexedTerminalTabNode],
    tabNodesByGroupID: [TerminalTabGroupID: [IndexedTerminalTabNode]]
  ) -> TerminalTabSessionTopology {
    var nodes: [TerminalTabNodeSession] = []
    var rootGroupIDs: [TerminalTabGroupID] = []
    var tabIDs: [TerminalTabID] = []
    for rootNodes in [pinnedRootNodes, regularRootNodes] {
      for (rootOrder, indexedRootNode) in rootNodes.enumerated() {
        var rootNode = indexedRootNode.node
        rootNode.order = rootOrder
        nodes.append(rootNode)
        switch rootNode.item {
        case .tab(let tabID):
          tabIDs.append(tabID)
        case .group(let groupID):
          rootGroupIDs.append(groupID)
          for (tabOrder, indexedTabNode) in (tabNodesByGroupID[groupID] ?? []).enumerated() {
            var tabNode = indexedTabNode.node
            tabNode.order = tabOrder
            nodes.append(tabNode)
            if let tabID = tabNode.item.tabID {
              tabIDs.append(tabID)
            }
          }
        }
      }
    }
    return TerminalTabSessionTopology(
      nodes: nodes,
      rootGroupIDs: rootGroupIDs,
      tabIDs: tabIDs
    )
  }

  var surfaceIDs: Set<UUID> {
    tabs.reduce(into: Set<UUID>()) { result, tab in
      result.formUnion(tab.surfaceIDs)
    }
  }
}

nonisolated private struct IndexedTerminalTabNode {
  let sourceIndex: Int
  let node: TerminalTabNodeSession
}

nonisolated private struct TerminalTabSessionTopology {
  let nodes: [TerminalTabNodeSession]
  let rootGroupIDs: [TerminalTabGroupID]
  let tabIDs: [TerminalTabID]
}

nonisolated struct TerminalTabNodeSession: Equatable, Codable, Sendable {
  var item: TerminalTabNodeSessionItem
  var parent: TerminalTabNodeSessionParent
  var order: Int
}

nonisolated enum TerminalTabNodeSessionItem: Equatable, Codable, Sendable {
  case tab(TerminalTabID)
  case group(TerminalTabGroupID)

  private enum CodingKeys: String, CodingKey {
    case kind
    case id
  }

  private enum Kind: String, Codable {
    case tab
    case group
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .tab:
      self = .tab(try container.decode(TerminalTabID.self, forKey: .id))
    case .group:
      self = .group(try container.decode(TerminalTabGroupID.self, forKey: .id))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .tab(let id):
      try container.encode(Kind.tab, forKey: .kind)
      try container.encode(id, forKey: .id)
    case .group(let id):
      try container.encode(Kind.group, forKey: .kind)
      try container.encode(id, forKey: .id)
    }
  }

  var tabID: TerminalTabID? {
    guard case .tab(let id) = self else { return nil }
    return id
  }

  var groupID: TerminalTabGroupID? {
    guard case .group(let id) = self else { return nil }
    return id
  }
}

nonisolated enum TerminalTabNodeSessionParent: Equatable, Codable, Sendable {
  case root(isPinned: Bool)
  case group(TerminalTabGroupID)

  private enum CodingKeys: String, CodingKey {
    case kind
    case isPinned
    case id
  }

  private enum Kind: String, Codable {
    case root
    case group
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .root:
      self = .root(isPinned: try container.decode(Bool.self, forKey: .isPinned))
    case .group:
      self = .group(try container.decode(TerminalTabGroupID.self, forKey: .id))
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .root(let isPinned):
      try container.encode(Kind.root, forKey: .kind)
      try container.encode(isPinned, forKey: .isPinned)
    case .group(let id):
      try container.encode(Kind.group, forKey: .kind)
      try container.encode(id, forKey: .id)
    }
  }

  var isPinned: Bool? {
    guard case .root(let isPinned) = self else { return nil }
    return isPinned
  }

  var groupID: TerminalTabGroupID? {
    guard case .group(let id) = self else { return nil }
    return id
  }
}

nonisolated struct TerminalTabGroupSession: Equatable, Codable, Sendable {
  var id: TerminalTabGroupID
  var title: String
  var color: TerminalTabGroupColor
  var lifetime: TerminalTabGroupLifetime

  func pruned() -> TerminalTabGroupSession {
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return TerminalTabGroupSession(
      id: id,
      title: title.isEmpty ? "Group" : title,
      color: color,
      lifetime: lifetime
    )
  }
}

extension TerminalTabGroupLifetime: Codable {
  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    switch try container.decode(String.self) {
    case "durable":
      self = .durable
    case "automatic":
      self = .automatic
    default:
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Unsupported tab group lifetime"
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .durable:
      try container.encode("durable")
    case .automatic:
      try container.encode("automatic")
    }
  }
}

nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  var id: TerminalTabID
  var lockedTitle: String?
  var focusedPaneIndex: Int
  var root: TerminalPaneNodeSession

  func pruned() -> TerminalTabSession? {
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(seenSurfaceIDs: &seenSurfaceIDs)
  }

  fileprivate func pruned(
    seenSurfaceIDs: inout Set<UUID>
  ) -> TerminalTabSession? {
    guard let root = root.pruned(seenSurfaceIDs: &seenSurfaceIDs) else { return nil }
    return TerminalTabSession(
      id: id,
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

  fileprivate func pruned(
    seenSurfaceIDs: inout Set<UUID>
  ) -> TerminalPaneNodeSession? {
    switch self {
    case .leaf(let leaf) where seenSurfaceIDs.insert(leaf.id).inserted:
      return .leaf(leaf.pruned())
    case .leaf:
      return nil
    case .split(let split):
      return split.pruned(seenSurfaceIDs: &seenSurfaceIDs)
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

  fileprivate func pruned(
    seenSurfaceIDs: inout Set<UUID>
  ) -> TerminalPaneNodeSession? {
    let left = left.pruned(seenSurfaceIDs: &seenSurfaceIDs)
    let right = right.pruned(seenSurfaceIDs: &seenSurfaceIDs)
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
