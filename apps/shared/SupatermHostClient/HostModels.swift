import Foundation

public typealias HostClientID = UUID
public typealias HostCommandID = UUID
public typealias HostID = UUID
public typealias HostPaneID = UUID
public typealias HostSpaceID = UUID
public typealias HostWindowID = UUID
public typealias HostGroupID = UUID
public typealias HostTabID = UUID
public typealias HostSplitID = UUID

public struct HostWorkspace: Codable, Equatable, Sendable {
  public let spaces: [HostSpace]
  public let windows: [String: HostWindow]

  public init(spaces: [HostSpace], windows: [String: HostWindow]) {
    self.spaces = spaces
    self.windows = windows
  }

  public func window(_ id: HostWindowID) -> HostWindow? {
    windows[id.uuidString.lowercased()] ?? windows[id.uuidString.uppercased()]
  }
}

public struct HostSpace: Codable, Equatable, Sendable, Identifiable {
  public let id: HostSpaceID
  public let name: String
  public let color: String
}

public struct HostWindow: Codable, Equatable, Sendable, Identifiable {
  public let id: HostWindowID
  public let spaces: [String: HostSpaceContent]

  public func content(_ id: HostSpaceID) -> HostSpaceContent? {
    spaces[id.uuidString.lowercased()] ?? spaces[id.uuidString.uppercased()]
  }
}

public struct HostSpaceContent: Codable, Equatable, Sendable {
  public let pinnedRoots: [HostItemID]
  public let regularRoots: [HostItemID]
  public let groups: [String: HostGroup]
  public let tabs: [String: HostTab]

  public func group(_ id: HostGroupID) -> HostGroup? {
    groups[id.uuidString.lowercased()] ?? groups[id.uuidString.uppercased()]
  }

  public func tab(_ id: HostTabID) -> HostTab? {
    tabs[id.uuidString.lowercased()] ?? tabs[id.uuidString.uppercased()]
  }
}

public enum HostItemID: Codable, Equatable, Hashable, Sendable {
  case tab(HostTabID)
  case group(HostGroupID)

  private enum CodingKeys: String, CodingKey {
    case type
    case id
  }

  private enum Kind: String, Codable {
    case tab
    case group
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .tab:
      self = .tab(try container.decode(HostTabID.self, forKey: .id))
    case .group:
      self = .group(try container.decode(HostGroupID.self, forKey: .id))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .tab(let id):
      try container.encode(Kind.tab, forKey: .type)
      try container.encode(id, forKey: .id)
    case .group(let id):
      try container.encode(Kind.group, forKey: .type)
      try container.encode(id, forKey: .id)
    }
  }
}

public struct HostGroup: Codable, Equatable, Sendable, Identifiable {
  public let id: HostGroupID
  public let title: String
  public let color: String
  public let tabs: [HostTabID]
  public let lifetime: HostGroupLifetime
}

public enum HostGroupLifetime: String, Codable, Equatable, Sendable {
  case durable
  case automatic
}

public struct HostTab: Codable, Equatable, Sendable, Identifiable {
  public let id: HostTabID
  public let title: String?
  public let root: HostSplitNode
}

public indirect enum HostSplitNode: Codable, Equatable, Sendable {
  case pane(paneID: HostPaneID, restartDirectory: String?)
  case split(
    splitID: HostSplitID,
    direction: HostSplitDirection,
    ratioMillionths: UInt32,
    first: HostSplitNode,
    second: HostSplitNode
  )

  private enum CodingKeys: String, CodingKey {
    case type
    case paneID
    case restartDirectory
    case splitID
    case direction
    case ratioMillionths
    case first
    case second
  }

  private enum Kind: String, Codable {
    case pane
    case split
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .pane:
      self = .pane(
        paneID: try container.decode(HostPaneID.self, forKey: .paneID),
        restartDirectory: try container.decodeIfPresent(String.self, forKey: .restartDirectory)
      )
    case .split:
      self = .split(
        splitID: try container.decode(HostSplitID.self, forKey: .splitID),
        direction: try container.decode(HostSplitDirection.self, forKey: .direction),
        ratioMillionths: try container.decode(UInt32.self, forKey: .ratioMillionths),
        first: try container.decode(HostSplitNode.self, forKey: .first),
        second: try container.decode(HostSplitNode.self, forKey: .second)
      )
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .pane(let paneID, let restartDirectory):
      try container.encode(Kind.pane, forKey: .type)
      try container.encode(paneID, forKey: .paneID)
      try container.encodeIfPresent(restartDirectory, forKey: .restartDirectory)
    case .split(let splitID, let direction, let ratioMillionths, let first, let second):
      try container.encode(Kind.split, forKey: .type)
      try container.encode(splitID, forKey: .splitID)
      try container.encode(direction, forKey: .direction)
      try container.encode(ratioMillionths, forKey: .ratioMillionths)
      try container.encode(first, forKey: .first)
      try container.encode(second, forKey: .second)
    }
  }

  public var paneIDs: [HostPaneID] {
    switch self {
    case .pane(let paneID, _):
      [paneID]
    case .split(_, _, _, let first, let second):
      first.paneIDs + second.paneIDs
    }
  }
}

public enum HostSplitDirection: String, Codable, Equatable, Sendable {
  case horizontal
  case vertical
}

public struct HostClientState: Codable, Equatable, Sendable, Identifiable {
  public let id: HostClientID
  public let activeWindowID: HostWindowID?
  public let windowOrder: [HostWindowID]
  public let windows: [String: HostClientWindowState]
  public let seenAgentRevisionByPane: [String: UInt64]
  public let seenNotificationRevisionByPane: [String: UInt64]

  public func window(_ id: HostWindowID) -> HostClientWindowState? {
    windows[id.uuidString.lowercased()] ?? windows[id.uuidString.uppercased()]
  }
}

public struct HostClientWindowState: Codable, Equatable, Sendable {
  public let isOpen: Bool
  public let displayedSpaceID: HostSpaceID
  public let previousSpaceID: HostSpaceID?
  public let selectedTabBySpace: [String: HostTabID]
  public let previousTabBySpace: [String: HostTabID]
  public let focusedPaneByTab: [String: HostPaneID]
  public let previousPaneByTab: [String: HostPaneID]
  public let zoomedPaneByTab: [String: HostPaneID]
  public let collapsedGroupsBySpace: [String: Set<HostGroupID>]
  public let sidebarCollapsed: Bool
  public let sidebarWidth: UInt16?
  public let hiddenAgentPanels: Set<HostPaneID>
  public let platformPlacement: HostPlatformWindowPlacement?

  public func selectedTab(_ spaceID: HostSpaceID) -> HostTabID? {
    selectedTabBySpace[spaceID.uuidString.lowercased()]
      ?? selectedTabBySpace[spaceID.uuidString.uppercased()]
  }

  public func focusedPane(_ tabID: HostTabID) -> HostPaneID? {
    focusedPaneByTab[tabID.uuidString.lowercased()]
      ?? focusedPaneByTab[tabID.uuidString.uppercased()]
  }

  public func zoomedPane(_ tabID: HostTabID) -> HostPaneID? {
    zoomedPaneByTab[tabID.uuidString.lowercased()]
      ?? zoomedPaneByTab[tabID.uuidString.uppercased()]
  }

  public func collapsedGroups(_ spaceID: HostSpaceID) -> Set<HostGroupID> {
    collapsedGroupsBySpace[spaceID.uuidString.lowercased()]
      ?? collapsedGroupsBySpace[spaceID.uuidString.uppercased()]
      ?? []
  }
}

public struct HostPlatformWindowPlacement: Codable, Equatable, Sendable {
  public let platform: String
  public let x: Int32
  public let y: Int32
  public let width: UInt32
  public let height: UInt32
  public let displayID: String?

  public init(
    platform: String,
    x: Int32,
    y: Int32,
    width: UInt32,
    height: UInt32,
    displayID: String?
  ) {
    self.platform = platform
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    self.displayID = displayID
  }
}

public struct HostProcessIdentity: Codable, Equatable, Sendable {
  public let pid: UInt32
  public let startIdentity: String
  public let foregroundProcessGroup: UInt32
  public let executable: String
}

public enum HostPaneLifecycle: String, Codable, Equatable, Sendable {
  case starting
  case running
  case failed
  case closing
}

public enum HostProgressState: String, Codable, Equatable, Sendable {
  case set
  case error
  case indeterminate
  case paused
}

public struct HostProgressReport: Codable, Equatable, Sendable {
  public let state: HostProgressState
  public let percent: UInt8?
}

public struct HostExitFact: Codable, Equatable, Sendable {
  public let code: Int32?
  public let signal: Int32?
}

public struct HostPaneFacts: Codable, Equatable, Sendable {
  public let paneID: HostPaneID
  public let lifecycle: HostPaneLifecycle
  public let pid: UInt32?
  public let title: String?
  public let currentDirectory: String?
  public let progress: HostProgressReport?
  public let failure: String?
  public let exit: HostExitFact?
  public let foregroundProcess: HostProcessIdentity?
}

public enum HostAgentPhase: String, Codable, Equatable, Sendable {
  case idle
  case working
  case blocked
  case unknown
}

public enum HostAgentAuthority: String, Codable, Equatable, Sendable {
  case hook
  case process
  case osc
  case screen
}

public struct HostAgentFact: Codable, Equatable, Sendable {
  public let paneID: HostPaneID
  public let kind: String?
  public let phase: HostAgentPhase
  public let authority: HostAgentAuthority
  public let processIdentity: HostProcessIdentity
  public let nativeSessionID: String?
  public let workingDirectory: String?
  public let commandArguments: [String]?
  public let ruleID: String?
  public let revision: UInt64
  public let attentionRevision: UInt64?
}

public enum HostNotificationOrigin: String, Codable, Equatable, Sendable {
  case bell
  case desktop
  case agent
}

public struct HostNotificationRecord: Codable, Equatable, Sendable, Identifiable {
  public let id: UUID
  public let paneID: HostPaneID
  public let origin: HostNotificationOrigin
  public let title: String?
  public let body: String?
  public let timestampMillis: UInt64
  public let attentionRevision: UInt64
}

public struct HostProcessTreeEntry: Codable, Equatable, Sendable {
  public let identity: HostProcessIdentity
  public let parentProcessID: UInt32
}

public struct HostListeningEndpoint: Codable, Equatable, Sendable {
  public let port: UInt16
  public let bindAddress: String
  public let `protocol`: String
  public let processIdentity: HostProcessIdentity
}

public enum HostPullRequestKind: String, Codable, Equatable, Sendable {
  case open
  case draft
  case merged
  case closed
}

public enum HostCheckState: String, Codable, Equatable, Sendable {
  case pending
  case passing
  case failing
  case skipped
}

public struct HostCheckFact: Codable, Equatable, Sendable {
  public let name: String
  public let state: HostCheckState
  public let url: String?
}

public struct HostPullRequestFact: Codable, Equatable, Sendable {
  public let kind: HostPullRequestKind
  public let title: String
  public let url: String
  public let addedLines: UInt64
  public let removedLines: UInt64
  public let checks: [HostCheckFact]
}

public struct HostRepositoryFact: Codable, Equatable, Sendable {
  public let root: String
  public let branch: String
  public let addedLines: UInt64
  public let removedLines: UInt64
  public let pullRequest: HostPullRequestFact?
}

public struct HostAgentEnrichment: Codable, Equatable, Sendable {
  public let paneID: HostPaneID
  public let sourceProcess: HostProcessIdentity
  public let processTree: [HostProcessTreeEntry]
  public let listeningEndpoints: [HostListeningEndpoint]
  public let repository: HostRepositoryFact?
  public let revision: UInt64
}

public struct HostModelSnapshot: Codable, Equatable, Sendable {
  public let epoch: UUID
  public let revision: UInt64
  public let structureRevision: UInt64
  public let workspace: HostWorkspace
  public let clientState: HostClientState?
  public let paneFacts: [String: HostPaneFacts]
  public let agentFacts: [String: HostAgentFact]
  public let notifications: [HostNotificationRecord]
  public let enrichments: [String: HostAgentEnrichment]
}

public struct HostMutationEvent: Codable, Equatable, Sendable {
  public let epoch: UUID
  public let revision: UInt64
  public let structureRevision: UInt64
  public let workspace: HostWorkspace?
  public let clientState: HostClientState?
  public let paneFacts: [String: HostPaneFacts]?
  public let agentFacts: [String: HostAgentFact]?
  public let notifications: [HostNotificationRecord]?
  public let enrichments: [String: HostAgentEnrichment]?
}

public enum HostSubscription: Codable, Equatable, Sendable {
  case snapshot(HostModelSnapshot)
  case replay([HostMutationEvent])

  private enum CodingKeys: String, CodingKey {
    case type
    case value
  }

  private enum Kind: String, Codable {
    case snapshot
    case replay
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .snapshot:
      self = .snapshot(try container.decode(HostModelSnapshot.self, forKey: .value))
    case .replay:
      self = .replay(try container.decode([HostMutationEvent].self, forKey: .value))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .snapshot(let snapshot):
      try container.encode(Kind.snapshot, forKey: .type)
      try container.encode(snapshot, forKey: .value)
    case .replay(let mutations):
      try container.encode(Kind.replay, forKey: .type)
      try container.encode(mutations, forKey: .value)
    }
  }
}
