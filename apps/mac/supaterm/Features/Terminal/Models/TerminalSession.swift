import CoreGraphics
import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated struct TerminalSessionCatalog: Equatable, Codable, Sendable {
  static let currentVersion = TerminalSessionCatalogVersion.current.rawValue
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

  static func storedCatalogWasRejected(
    url: URL = Self.defaultURL(),
    fileManager: FileManager = .default
  ) -> Bool {
    guard fileManager.fileExists(atPath: url.path(percentEncoded: false)) else { return false }
    guard let data = try? Data(contentsOf: url) else { return true }
    return (try? JSONDecoder().decode(Self.self, from: data)) == nil
  }

  var surfaceIDs: Set<UUID> {
    windows.reduce(into: Set<UUID>()) { result, window in
      result.formUnion(window.surfaceIDs)
    }
  }

  func pruned(
    validSpaceIDs: Set<TerminalSpaceID>,
    allowsExistingSessions: Bool = true
  ) -> Self {
    var seenTabIDs: Set<TerminalTabID> = []
    var seenSurfaceIDs: Set<UUID> = []
    return Self(
      windows: windows.compactMap {
        $0.pruned(
          validSpaceIDs: validSpaceIDs,
          seenTabIDs: &seenTabIDs,
          seenSurfaceIDs: &seenSurfaceIDs,
          allowsExistingSessions: allowsExistingSessions
        )
      }
    )
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

nonisolated struct TerminalWindowSession: Equatable, Codable, Sendable {
  var displayedSpaceID: TerminalSpaceID
  var spaces: [TerminalSpaceSession]
  var frame: TerminalWindowFrame?
  var sidebarWidth: Double?

  init(
    displayedSpaceID: TerminalSpaceID,
    spaces: [TerminalSpaceSession],
    frame: TerminalWindowFrame? = nil,
    sidebarWidth: Double? = nil
  ) {
    self.displayedSpaceID = displayedSpaceID
    self.spaces = spaces
    self.frame = frame
    self.sidebarWidth = sidebarWidth
  }

  var displayedSpace: TerminalSpaceSession? {
    spaces.first { $0.spaceID == displayedSpaceID }
  }

  var surfaceIDs: Set<UUID> {
    spaces.reduce(into: Set<UUID>()) { result, space in
      result.formUnion(space.surfaceIDs)
    }
  }

  var containsExistingSession: Bool {
    spaces.contains(where: \.containsExistingSession)
  }

  func pruned(
    validSpaceIDs: Set<TerminalSpaceID>,
    allowsExistingSessions: Bool = true
  ) -> TerminalWindowSession? {
    var seenTabIDs: Set<TerminalTabID> = []
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(
      validSpaceIDs: validSpaceIDs,
      seenTabIDs: &seenTabIDs,
      seenSurfaceIDs: &seenSurfaceIDs,
      allowsExistingSessions: allowsExistingSessions
    )
  }

  fileprivate func pruned(
    validSpaceIDs: Set<TerminalSpaceID>,
    seenTabIDs: inout Set<TerminalTabID>,
    seenSurfaceIDs: inout Set<UUID>,
    allowsExistingSessions: Bool
  ) -> TerminalWindowSession? {
    var seenSpaceIDs: Set<TerminalSpaceID> = []
    var prunedSpaces: [TerminalSpaceSession] = []
    for space in spaces
    where validSpaceIDs.contains(space.spaceID) && seenSpaceIDs.insert(space.spaceID).inserted {
      let prunedSpace = space.pruned(
        excludingTabIDs: seenTabIDs,
        seenSurfaceIDs: &seenSurfaceIDs,
        allowsExistingSessions: allowsExistingSessions
      )
      seenTabIDs.formUnion(prunedSpace.tabs.map(\.id))
      prunedSpaces.append(prunedSpace)
    }
    guard let firstSpaceID = prunedSpaces.first?.spaceID else { return nil }
    guard
      allowsExistingSessions
        || !containsExistingSession
        || prunedSpaces.contains(where: { !$0.surfaceIDs.isEmpty })
    else { return nil }
    return TerminalWindowSession(
      displayedSpaceID: seenSpaceIDs.contains(displayedSpaceID) ? displayedSpaceID : firstSpaceID,
      spaces: prunedSpaces,
      frame: frame,
      sidebarWidth: sidebarWidth
    )
  }
}

nonisolated struct TerminalSpaceSession: Equatable, Codable, Sendable {
  var spaceID: TerminalSpaceID
  var selectedTabID: TerminalTabID?
  var collapsedProjectIDs: [TerminalProjectID] = []
  var isUnassignedCollapsed = false
  var tabs: [TerminalTabSession]

  func pruned() -> TerminalSpaceSession {
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(
      excludingTabIDs: [],
      seenSurfaceIDs: &seenSurfaceIDs,
      allowsExistingSessions: true
    )
  }

  fileprivate func pruned(
    excludingTabIDs: Set<TerminalTabID>,
    seenSurfaceIDs: inout Set<UUID>,
    allowsExistingSessions: Bool
  ) -> TerminalSpaceSession {
    var seenTabIDs = excludingTabIDs
    let orderedTabs = tabs.filter(\.isPinned) + tabs.filter { !$0.isPinned }
    let resolvedTabs = orderedTabs.compactMap { tab -> TerminalTabSession? in
      guard seenTabIDs.insert(tab.id).inserted else { return nil }
      return tab.pruned(
        seenSurfaceIDs: &seenSurfaceIDs,
        allowsExistingSessions: allowsExistingSessions
      )
    }
    let resolvedTabIDs = Set(resolvedTabs.map(\.id))
    var seenCollapsedProjectIDs: Set<TerminalProjectID> = []
    let selectedTabID =
      selectedTabID.flatMap { resolvedTabIDs.contains($0) ? $0 : nil }
      ?? resolvedTabs.first?.id
    return TerminalSpaceSession(
      spaceID: spaceID,
      selectedTabID: selectedTabID,
      collapsedProjectIDs: collapsedProjectIDs.filter {
        seenCollapsedProjectIDs.insert($0).inserted
      },
      isUnassignedCollapsed: isUnassignedCollapsed,
      tabs: resolvedTabs
    )
  }

  var surfaceIDs: Set<UUID> {
    tabs.reduce(into: Set<UUID>()) { result, tab in
      result.formUnion(tab.surfaceIDs)
    }
  }

  var containsExistingSession: Bool {
    tabs.contains { $0.root.containsExistingSession }
  }
}

nonisolated struct TerminalTabSession: Equatable, Codable, Sendable {
  var id: TerminalTabID
  var projectID: TerminalProjectID?
  var isPinned = false
  var lockedTitle: String?
  var focusedPaneIndex: Int
  var root: TerminalPaneNodeSession

  func pruned() -> TerminalTabSession? {
    var seenSurfaceIDs: Set<UUID> = []
    return pruned(seenSurfaceIDs: &seenSurfaceIDs, allowsExistingSessions: true)
  }

  fileprivate func pruned(
    seenSurfaceIDs: inout Set<UUID>,
    allowsExistingSessions: Bool
  ) -> TerminalTabSession? {
    let surfaceIDs = root.orderedSurfaceIDs
    let focusedSurfaceID =
      surfaceIDs.indices.contains(focusedPaneIndex) ? surfaceIDs[focusedPaneIndex] : nil
    guard
      let root = root.pruned(
        seenSurfaceIDs: &seenSurfaceIDs,
        allowsExistingSessions: allowsExistingSessions
      )
    else { return nil }
    return TerminalTabSession(
      id: id,
      projectID: projectID,
      isPinned: isPinned,
      lockedTitle: lockedTitle?.isEmpty == true ? nil : lockedTitle,
      focusedPaneIndex: focusedSurfaceID.flatMap {
        root.orderedSurfaceIDs.firstIndex(of: $0)
      } ?? 0,
      root: root
    )
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

  var containsExistingSession: Bool {
    switch self {
    case .leaf(let leaf):
      return leaf.restoreMode == .existingSession
    case .split(let split):
      return split.left.containsExistingSession || split.right.containsExistingSession
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

  var orderedSurfaceIDs: [UUID] {
    switch self {
    case .leaf(let leaf):
      return [leaf.id]
    case .split(let split):
      return split.left.orderedSurfaceIDs + split.right.orderedSurfaceIDs
    }
  }

  func leaf(id: UUID) -> TerminalPaneLeafSession? {
    switch self {
    case .leaf(let leaf):
      leaf.id == id ? leaf : nil
    case .split(let split):
      split.left.leaf(id: id) ?? split.right.leaf(id: id)
    }
  }

  fileprivate func pruned(
    seenSurfaceIDs: inout Set<UUID>,
    allowsExistingSessions: Bool
  ) -> TerminalPaneNodeSession? {
    switch self {
    case .leaf(let leaf)
    where (allowsExistingSessions || leaf.restoreMode == .shell)
      && seenSurfaceIDs.insert(leaf.id).inserted:
      return .leaf(leaf.pruned())
    case .leaf:
      return nil
    case .split(let split):
      return split.pruned(
        seenSurfaceIDs: &seenSurfaceIDs,
        allowsExistingSessions: allowsExistingSessions
      )
    }
  }

}

nonisolated enum TerminalPaneRestoreMode: String, Equatable, Codable, Sendable {
  case shell
  case existingSession
}

nonisolated struct TerminalPaneLeafSession: Equatable, Codable, Sendable {
  var id: UUID
  var workingDirectoryPath: String?
  var titleOverride: String?
  var agents: [TerminalPaneAgentRecord]
  var restoreMode: TerminalPaneRestoreMode

  init(
    id: UUID = UUID(),
    workingDirectoryPath: String?,
    titleOverride: String? = nil,
    agents: [TerminalPaneAgentRecord] = [],
    restoreMode: TerminalPaneRestoreMode = .shell
  ) {
    self.id = id
    self.workingDirectoryPath = workingDirectoryPath
    self.titleOverride = titleOverride
    self.agents = agents
    self.restoreMode = restoreMode
  }

  func pruned() -> TerminalPaneLeafSession {
    let workingDirectoryPath =
      workingDirectoryPath?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return TerminalPaneLeafSession(
      id: id,
      workingDirectoryPath: workingDirectoryPath?.isEmpty == true ? nil : workingDirectoryPath,
      titleOverride: titleOverride?.isEmpty == true ? nil : titleOverride,
      agents: agents.compactMap { $0.pruned() },
      restoreMode: restoreMode
    )
  }
}

nonisolated struct TerminalPaneAgentRecord: Equatable, Codable, Sendable {
  let agent: SupatermAgentKind
  let sessionID: String
  let processes: [TerminalAgentProcessIdentity]
  let turnLifecycle: TerminalAgentTurnLifecycle
  let phase: AgentActivityPhase
  let detail: String?
  let attentionRequestID: String?
  let latestResponse: String?
  let progressRows: [PaneAgentProgressRow]
  let activeChildren: [TerminalAgentActiveChild]
  let hasPendingBackgroundWork: Bool
  let isForeground: Bool
  let revision: Int
  let workingDirectoryPath: String?

  init(
    agent: SupatermAgentKind,
    sessionID: String,
    processes: [TerminalAgentProcessIdentity],
    turnLifecycle: TerminalAgentTurnLifecycle = .unseen,
    phase: AgentActivityPhase = .idle,
    detail: String? = nil,
    attentionRequestID: String? = nil,
    latestResponse: String? = nil,
    progressRows: [PaneAgentProgressRow] = [],
    activeChildren: [TerminalAgentActiveChild] = [],
    hasPendingBackgroundWork: Bool = false,
    isForeground: Bool = false,
    revision: Int = 0,
    workingDirectoryPath: String? = nil
  ) {
    self.agent = agent
    self.sessionID = sessionID
    self.processes = processes
    self.turnLifecycle = turnLifecycle
    self.phase = phase
    self.detail = detail
    self.attentionRequestID = attentionRequestID
    self.latestResponse = latestResponse
    self.progressRows = progressRows
    self.activeChildren = activeChildren
    self.hasPendingBackgroundWork = hasPendingBackgroundWork
    self.isForeground = isForeground
    self.revision = revision
    self.workingDirectoryPath = workingDirectoryPath
  }

  init(snapshot: TerminalAgentStateSnapshot) {
    self.init(
      agent: snapshot.agent,
      sessionID: snapshot.sessionID,
      processes: Array(snapshot.processes),
      turnLifecycle: snapshot.turnLifecycle,
      phase: snapshot.phase,
      detail: snapshot.detail,
      attentionRequestID: snapshot.attentionRequestID,
      latestResponse: snapshot.latestResponse,
      progressRows: snapshot.progressRows,
      activeChildren: snapshot.activeChildren,
      hasPendingBackgroundWork: snapshot.hasPendingBackgroundWork,
      isForeground: snapshot.isForeground,
      revision: snapshot.revision,
      workingDirectoryPath: snapshot.workingDirectoryPath
    )
  }

  func snapshot(
    surfaceID: UUID,
    processes: Set<TerminalAgentProcessIdentity>
  ) -> TerminalAgentStateSnapshot {
    return TerminalAgentStateSnapshot(
      agent: agent,
      sessionID: sessionID,
      surfaceID: surfaceID,
      processes: processes,
      turnLifecycle: turnLifecycle,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      latestResponse: latestResponse,
      isActionable: false,
      progressRows: progressRows,
      activeChildren: activeChildren,
      hasPendingBackgroundWork: hasPendingBackgroundWork,
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
      turnLifecycle: turnLifecycle,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      latestResponse: latestResponse,
      progressRows: progressRows,
      activeChildren: activeChildren,
      hasPendingBackgroundWork: hasPendingBackgroundWork,
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
    seenSurfaceIDs: inout Set<UUID>,
    allowsExistingSessions: Bool
  ) -> TerminalPaneNodeSession? {
    let left = left.pruned(
      seenSurfaceIDs: &seenSurfaceIDs,
      allowsExistingSessions: allowsExistingSessions
    )
    let right = right.pruned(
      seenSurfaceIDs: &seenSurfaceIDs,
      allowsExistingSessions: allowsExistingSessions
    )
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
    case (.some(let node), .none), (.none, .some(let node)):
      return node
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
