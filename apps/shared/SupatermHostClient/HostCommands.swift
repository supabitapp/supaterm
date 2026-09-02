import Foundation

public struct HostEnvironmentVariable: Codable, Equatable, Sendable {
  public let key: String
  public let value: String

  public init(key: String, value: String) {
    self.key = key
    self.value = value
  }

  public init(from decoder: any Decoder) throws {
    var container = try decoder.unkeyedContainer()
    key = try container.decode(String.self)
    value = try container.decode(String.self)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.unkeyedContainer()
    try container.encode(key)
    try container.encode(value)
  }
}

public struct HostSpawnSpec: Codable, Equatable, Sendable {
  public let argv: [String]
  public let cwd: String?
  public let environment: [HostEnvironmentVariable]
  public let rows: UInt16
  public let columns: UInt16
  public let pixelWidth: UInt16
  public let pixelHeight: UInt16

  public init(
    argv: [String] = [],
    cwd: String? = nil,
    environment: [HostEnvironmentVariable] = [],
    rows: UInt16,
    columns: UInt16,
    pixelWidth: UInt16,
    pixelHeight: UInt16
  ) {
    self.argv = argv
    self.cwd = cwd
    self.environment = environment
    self.rows = rows
    self.columns = columns
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
  }
}

public struct HostViewport: Codable, Equatable, Sendable {
  public let rows: UInt16
  public let columns: UInt16
  public let pixelWidth: UInt16
  public let pixelHeight: UInt16

  public init(rows: UInt16, columns: UInt16, pixelWidth: UInt16, pixelHeight: UInt16) {
    self.rows = rows
    self.columns = columns
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
  }
}

public enum HostSplitPlacement: String, Codable, Equatable, Sendable {
  case before
  case after
}

public enum HostPlacement: Encodable, Equatable, Sendable {
  case root(pinned: Bool, index: Int)
  case group(groupID: HostGroupID, index: Int)

  private enum CodingKeys: String, CodingKey {
    case type
    case pinned
    case index
    case groupID
  }

  private enum Kind: String, Encodable {
    case root
    case group
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .root(let pinned, let index):
      try container.encode(Kind.root, forKey: .type)
      try container.encode(pinned, forKey: .pinned)
      try container.encode(index, forKey: .index)
    case .group(let groupID, let index):
      try container.encode(Kind.group, forKey: .type)
      try container.encode(groupID, forKey: .groupID)
      try container.encode(index, forKey: .index)
    }
  }
}

public enum HostWorkspaceCommand: Encodable, Equatable, Sendable {
  case addSpace(spaceID: HostSpaceID, name: String, color: String)
  case deleteSpace(spaceID: HostSpaceID)
  case renameSpace(spaceID: HostSpaceID, name: String)
  case reorderSpace(spaceID: HostSpaceID, index: Int)
  case addWindow(windowID: HostWindowID)
  case closeWindow(windowID: HostWindowID)
  case createTab(
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    tabID: HostTabID,
    paneID: HostPaneID,
    placement: HostPlacement,
    title: String?,
    restartDirectory: String?
  )
  case createGroup(
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    groupID: HostGroupID,
    title: String,
    color: String,
    tabIDs: [HostTabID]
  )
  case renameGroup(groupID: HostGroupID, title: String)
  case moveItems(
    sourceWindowID: HostWindowID,
    sourceSpaceID: HostSpaceID,
    itemIDs: [HostItemID],
    destinationWindowID: HostWindowID,
    destinationSpaceID: HostSpaceID,
    destination: HostPlacement
  )
  case ungroup(windowID: HostWindowID, spaceID: HostSpaceID, groupID: HostGroupID)
  case closeTab(windowID: HostWindowID, spaceID: HostSpaceID, tabID: HostTabID)
  case closeGroup(windowID: HostWindowID, spaceID: HostSpaceID, groupID: HostGroupID)
  case splitPane(
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    tabID: HostTabID,
    targetPaneID: HostPaneID,
    paneID: HostPaneID,
    splitID: HostSplitID,
    direction: HostSplitDirection,
    placement: HostSplitPlacement,
    restartDirectory: String?
  )
  case closePane(paneID: HostPaneID)
  case setSplitRatio(splitID: HostSplitID, ratio: Double)
  case tileTab(windowID: HostWindowID, spaceID: HostSpaceID, tabID: HostTabID, splitIDs: [HostSplitID])
  case mainVerticalTab(
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    tabID: HostTabID,
    splitIDs: [HostSplitID]
  )
  case selectSpace(
    clientID: HostClientID,
    windowID: HostWindowID,
    spaceID: HostSpaceID
  )
  case selectTab(
    clientID: HostClientID,
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    tabID: HostTabID
  )
  case focusPane(
    clientID: HostClientID,
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    tabID: HostTabID,
    paneID: HostPaneID
  )
  case markAgentSeen(clientID: HostClientID, paneID: HostPaneID, revision: UInt64)
  case markNotificationSeen(clientID: HostClientID, paneID: HostPaneID, revision: UInt64)
  case setGroupCollapsed(
    clientID: HostClientID,
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    groupID: HostGroupID,
    collapsed: Bool
  )
  case detachToWindow(
    sourceWindowID: HostWindowID,
    sourceSpaceID: HostSpaceID,
    itemIDs: [HostItemID],
    windowID: HostWindowID
  )
  case mergeWindow(sourceWindowID: HostWindowID, destinationWindowID: HostWindowID)

  private enum CodingKeys: String, CodingKey {
    case type
    case spaceID
    case name
    case color
    case index
    case windowID
    case tabID
    case paneID
    case placement
    case title
    case restartDirectory
    case groupID
    case tabIDs
    case sourceWindowID
    case sourceSpaceID
    case itemIDs
    case destinationWindowID
    case destinationSpaceID
    case destination
    case targetPaneID
    case splitID
    case direction
    case splitIDs
    case ratio
    case clientID
    case revision
    case collapsed
  }

  private enum Kind: String, Encodable {
    case addSpace = "add_space"
    case deleteSpace = "delete_space"
    case renameSpace = "rename_space"
    case reorderSpace = "reorder_space"
    case addWindow = "add_window"
    case closeWindow = "close_window"
    case createTab = "create_tab"
    case createGroup = "create_group"
    case renameGroup = "rename_group"
    case moveItems = "move_items"
    case ungroup
    case closeTab = "close_tab"
    case closeGroup = "close_group"
    case splitPane = "split_pane"
    case closePane = "close_pane"
    case setSplitRatio = "set_split_ratio"
    case tileTab = "tile_tab"
    case mainVerticalTab = "main_vertical_tab"
    case selectSpace = "select_space"
    case selectTab = "select_tab"
    case focusPane = "focus_pane"
    case markAgentSeen = "mark_agent_seen"
    case markNotificationSeen = "mark_notification_seen"
    case setGroupCollapsed = "set_group_collapsed"
    case detachToWindow = "detach_to_window"
    case mergeWindow = "merge_window"
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    if try encodeCatalog(into: &container) { return }
    if try encodeLayout(into: &container) { return }
    if try encodeClientState(into: &container) { return }
    preconditionFailure("unknown workspace command")
  }

  private func encodeCatalog(
    into container: inout KeyedEncodingContainer<CodingKeys>
  ) throws -> Bool {
    switch self {
    case .addSpace(let spaceID, let name, let color):
      try container.encode(Kind.addSpace, forKey: .type)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(name, forKey: .name)
      try container.encode(color, forKey: .color)
    case .deleteSpace(let spaceID):
      try container.encode(Kind.deleteSpace, forKey: .type)
      try container.encode(spaceID, forKey: .spaceID)
    case .renameSpace(let spaceID, let name):
      try container.encode(Kind.renameSpace, forKey: .type)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(name, forKey: .name)
    case .reorderSpace(let spaceID, let index):
      try container.encode(Kind.reorderSpace, forKey: .type)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(index, forKey: .index)
    case .addWindow(let windowID):
      try container.encode(Kind.addWindow, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
    case .closeWindow(let windowID):
      try container.encode(Kind.closeWindow, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
    case .createTab(
      let windowID,
      let spaceID,
      let tabID,
      let paneID,
      let placement,
      let title,
      let restartDirectory
    ):
      try container.encode(Kind.createTab, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
      try container.encode(paneID, forKey: .paneID)
      try container.encode(placement, forKey: .placement)
      try container.encodeIfPresent(title, forKey: .title)
      try container.encodeIfPresent(restartDirectory, forKey: .restartDirectory)
    case .createGroup(let windowID, let spaceID, let groupID, let title, let color, let tabIDs):
      try container.encode(Kind.createGroup, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(groupID, forKey: .groupID)
      try container.encode(title, forKey: .title)
      try container.encode(color, forKey: .color)
      try container.encode(tabIDs, forKey: .tabIDs)
    case .renameGroup(let groupID, let title):
      try container.encode(Kind.renameGroup, forKey: .type)
      try container.encode(groupID, forKey: .groupID)
      try container.encode(title, forKey: .title)
    case .moveItems(
      let sourceWindowID,
      let sourceSpaceID,
      let itemIDs,
      let destinationWindowID,
      let destinationSpaceID,
      let destination
    ):
      try container.encode(Kind.moveItems, forKey: .type)
      try container.encode(sourceWindowID, forKey: .sourceWindowID)
      try container.encode(sourceSpaceID, forKey: .sourceSpaceID)
      try container.encode(itemIDs, forKey: .itemIDs)
      try container.encode(destinationWindowID, forKey: .destinationWindowID)
      try container.encode(destinationSpaceID, forKey: .destinationSpaceID)
      try container.encode(destination, forKey: .destination)
    case .ungroup(let windowID, let spaceID, let groupID):
      try container.encode(Kind.ungroup, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(groupID, forKey: .groupID)
    default:
      return false
    }
    return true
  }

  private func encodeLayout(
    into container: inout KeyedEncodingContainer<CodingKeys>
  ) throws -> Bool {
    switch self {
    case .closeTab(let windowID, let spaceID, let tabID):
      try container.encode(Kind.closeTab, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
    case .closeGroup(let windowID, let spaceID, let groupID):
      try container.encode(Kind.closeGroup, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(groupID, forKey: .groupID)
    case .splitPane(
      let windowID,
      let spaceID,
      let tabID,
      let targetPaneID,
      let paneID,
      let splitID,
      let direction,
      let placement,
      let restartDirectory
    ):
      try container.encode(Kind.splitPane, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
      try container.encode(targetPaneID, forKey: .targetPaneID)
      try container.encode(paneID, forKey: .paneID)
      try container.encode(splitID, forKey: .splitID)
      try container.encode(direction, forKey: .direction)
      try container.encode(placement, forKey: .placement)
      try container.encodeIfPresent(restartDirectory, forKey: .restartDirectory)
    case .closePane(let paneID):
      try container.encode(Kind.closePane, forKey: .type)
      try container.encode(paneID, forKey: .paneID)
    case .setSplitRatio(let splitID, let ratio):
      try container.encode(Kind.setSplitRatio, forKey: .type)
      try container.encode(splitID, forKey: .splitID)
      try container.encode(ratio, forKey: .ratio)
    case .tileTab(let windowID, let spaceID, let tabID, let splitIDs):
      try container.encode(Kind.tileTab, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
      try container.encode(splitIDs, forKey: .splitIDs)
    case .mainVerticalTab(let windowID, let spaceID, let tabID, let splitIDs):
      try container.encode(Kind.mainVerticalTab, forKey: .type)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
      try container.encode(splitIDs, forKey: .splitIDs)
    case .detachToWindow(let sourceWindowID, let sourceSpaceID, let itemIDs, let windowID):
      try container.encode(Kind.detachToWindow, forKey: .type)
      try container.encode(sourceWindowID, forKey: .sourceWindowID)
      try container.encode(sourceSpaceID, forKey: .sourceSpaceID)
      try container.encode(itemIDs, forKey: .itemIDs)
      try container.encode(windowID, forKey: .windowID)
    case .mergeWindow(let sourceWindowID, let destinationWindowID):
      try container.encode(Kind.mergeWindow, forKey: .type)
      try container.encode(sourceWindowID, forKey: .sourceWindowID)
      try container.encode(destinationWindowID, forKey: .destinationWindowID)
    default:
      return false
    }
    return true
  }

  private func encodeClientState(
    into container: inout KeyedEncodingContainer<CodingKeys>
  ) throws -> Bool {
    switch self {
    case .selectSpace(let clientID, let windowID, let spaceID):
      try container.encode(Kind.selectSpace, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
    case .selectTab(let clientID, let windowID, let spaceID, let tabID):
      try container.encode(Kind.selectTab, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
    case .focusPane(let clientID, let windowID, let spaceID, let tabID, let paneID):
      try container.encode(Kind.focusPane, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(tabID, forKey: .tabID)
      try container.encode(paneID, forKey: .paneID)
    case .markAgentSeen(let clientID, let paneID, let revision):
      try container.encode(Kind.markAgentSeen, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(paneID, forKey: .paneID)
      try container.encode(revision, forKey: .revision)
    case .markNotificationSeen(let clientID, let paneID, let revision):
      try container.encode(Kind.markNotificationSeen, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(paneID, forKey: .paneID)
      try container.encode(revision, forKey: .revision)
    case .setGroupCollapsed(
      let clientID,
      let windowID,
      let spaceID,
      let groupID,
      let collapsed
    ):
      try container.encode(Kind.setGroupCollapsed, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
      try container.encode(windowID, forKey: .windowID)
      try container.encode(spaceID, forKey: .spaceID)
      try container.encode(groupID, forKey: .groupID)
      try container.encode(collapsed, forKey: .collapsed)
    default:
      return false
    }
    return true
  }
}

public struct HostApplyRequest: Encodable, Equatable, Sendable {
  public let command: HostWorkspaceCommand
  public let expectedStructureRevision: UInt64?
  public let spawnSpecs: [String: HostSpawnSpec]
  public let confirmationTokens: [String: UUID]
}

public struct HostReducerResult: Codable, Equatable, Sendable {
  public let focusPaneID: HostPaneID?
}

public struct HostApplyResult: Codable, Equatable, Sendable {
  public let revision: UInt64
  public let structureRevision: UInt64
  public let reducer: HostReducerResult
  public let startingPaneIDs: [HostPaneID]
  public let closingPaneIDs: [HostPaneID]
}

public struct HostSubscribeRequest: Encodable, Equatable, Sendable {
  public let afterRevision: UInt64?

  public init(afterRevision: UInt64?) {
    self.afterRevision = afterRevision
  }
}

public struct HostTerminalAttachRequest: Encodable, Equatable, Sendable {
  public let paneID: HostPaneID
  public let streamID: UInt32
}

public struct HostTerminalStreamRequest: Encodable, Equatable, Sendable {
  public let streamID: UInt32
}

public struct HostTerminalResizeRequest: Encodable, Equatable, Sendable {
  public let streamID: UInt32
  public let viewport: HostViewport
}

public struct HostTerminalStreamResult: Decodable, Equatable, Sendable {
  public let streamID: UInt32
}

public struct HostTerminalClaimResult: Decodable, Equatable, Sendable {
  public let generation: UInt64
}
