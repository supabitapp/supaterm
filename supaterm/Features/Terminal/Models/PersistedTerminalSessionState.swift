import Foundation

nonisolated struct PersistedTerminalSessionCatalog: Equatable, Codable, Sendable {
  var defaultSelectedWorkspaceID: TerminalWorkspaceID
  var selectionUpdatedAt: UInt64
  var workspaces: [PersistedTerminalWorkspaceState]
  var workspaceTombstones: [PersistedTerminalWorkspaceTombstone] = []
  var tabTombstones: [PersistedTerminalTabTombstone] = []
  var paneTombstones: [PersistedTerminalPaneTombstone] = []

  static let `default` = Self.makeDefault()

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("sessions.json", isDirectory: false)
  }

  static func sanitized(_ catalog: Self?) -> Self {
    guard let catalog else { return .default }

    let workspaces = catalog.workspaces.compactMap { workspace -> PersistedTerminalWorkspaceState? in
      if let tombstone = catalog.workspaceTombstones.first(where: { $0.id == workspace.id }),
        tombstone.deletedAt >= workspace.updatedAt
      {
        return nil
      }
      let trimmedName = workspace.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }

      let tabs = workspace.tabs.compactMap { tab -> PersistedTerminalTab? in
        if let tombstone = catalog.tabTombstones.first(where: { $0.id == tab.id }),
          tombstone.deletedAt >= tab.updatedAt
        {
          return nil
        }

        let panes = tab.panes.compactMap { pane -> PersistedTerminalPane? in
          if let tombstone = catalog.paneTombstones.first(where: { $0.id == pane.id }),
            tombstone.deletedAt >= pane.updatedAt
          {
            return nil
          }
          return pane
        }
        guard !panes.isEmpty else { return nil }

        let selectedPaneID =
          panes.contains(where: { $0.id == tab.selectedPaneID })
          ? tab.selectedPaneID
          : panes[0].id

        return PersistedTerminalTab(
          id: tab.id,
          updatedAt: tab.updatedAt,
          title: tab.title,
          icon: tab.icon,
          isPinned: tab.isPinned,
          isTitleLocked: tab.isTitleLocked,
          selectedPaneID: selectedPaneID,
          panes: panes,
          splitTree: tab.splitTree
        )
      }
      let selectedTabID =
        workspace.selectedTabID.flatMap { selectedTabID in
          tabs.contains(where: { $0.id == selectedTabID }) ? selectedTabID : nil
        }

      return PersistedTerminalWorkspaceState(
        id: workspace.id,
        updatedAt: workspace.updatedAt,
        name: trimmedName,
        tabs: tabs,
        selectedTabID: selectedTabID
      )
    }
    guard !workspaces.isEmpty else { return .default }

    let defaultSelectedWorkspaceID =
      workspaces.contains(where: { $0.id == catalog.defaultSelectedWorkspaceID })
      ? catalog.defaultSelectedWorkspaceID
      : workspaces[0].id

    return Self(
      defaultSelectedWorkspaceID: defaultSelectedWorkspaceID,
      selectionUpdatedAt: catalog.selectionUpdatedAt,
      workspaces: workspaces,
      workspaceTombstones: catalog.workspaceTombstones,
      tabTombstones: catalog.tabTombstones,
      paneTombstones: catalog.paneTombstones
    )
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDefault() -> Self {
    let workspace = PersistedTerminalWorkspaceState(name: "A")
    return Self(
      defaultSelectedWorkspaceID: workspace.id,
      selectionUpdatedAt: Self.currentTimestamp(),
      workspaces: [workspace]
    )
  }

  static func currentTimestamp(date: Date = Date()) -> UInt64 {
    UInt64(date.timeIntervalSince1970 * 1000)
  }
}

nonisolated struct PersistedTerminalPane: Equatable, Codable, Sendable {
  let id: UUID
  var sessionName: String
  var updatedAt: UInt64
  var title: String?
  var workingDirectoryPath: String?
  var lastKnownRunning: Bool?

  init(
    id: UUID = UUID(),
    sessionName: String,
    updatedAt: UInt64 = PersistedTerminalSessionCatalog.currentTimestamp(),
    title: String? = nil,
    workingDirectoryPath: String? = nil,
    lastKnownRunning: Bool? = nil
  ) {
    self.id = id
    self.sessionName = sessionName
    self.updatedAt = updatedAt
    self.title = title
    self.workingDirectoryPath = workingDirectoryPath
    self.lastKnownRunning = lastKnownRunning
  }
}

nonisolated struct PersistedTerminalSplitTree: Equatable, Codable, Sendable {
  indirect enum Node: Equatable, Codable, Sendable {
    case leaf(UUID)
    case split(Split)
  }

  struct Split: Equatable, Codable, Sendable {
    enum Direction: String, Equatable, Codable, Sendable {
      case horizontal
      case vertical
    }

    var direction: Direction
    var ratio: Double
    var left: Node
    var right: Node

    init(
      direction: Direction,
      ratio: Double,
      left: Node,
      right: Node
    ) {
      self.direction = direction
      self.ratio = ratio
      self.left = left
      self.right = right
    }
  }

  var root: Node
  var zoomedPaneID: UUID?

  init(
    root: Node,
    zoomedPaneID: UUID? = nil
  ) {
    self.root = root
    self.zoomedPaneID = zoomedPaneID
  }
}

nonisolated struct PersistedTerminalTab: Equatable, Codable, Sendable {
  let id: TerminalTabID
  var updatedAt: UInt64
  var title: String
  var icon: String?
  var isPinned: Bool
  var isTitleLocked: Bool
  var selectedPaneID: UUID
  var panes: [PersistedTerminalPane]
  var splitTree: PersistedTerminalSplitTree

  init(
    id: TerminalTabID = TerminalTabID(),
    updatedAt: UInt64 = PersistedTerminalSessionCatalog.currentTimestamp(),
    title: String,
    icon: String? = nil,
    isPinned: Bool = false,
    isTitleLocked: Bool = false,
    selectedPaneID: UUID,
    panes: [PersistedTerminalPane],
    splitTree: PersistedTerminalSplitTree
  ) {
    self.id = id
    self.updatedAt = updatedAt
    self.title = title
    self.icon = icon
    self.isPinned = isPinned
    self.isTitleLocked = isTitleLocked
    self.selectedPaneID = selectedPaneID
    self.panes = panes
    self.splitTree = splitTree
  }
}

nonisolated struct PersistedTerminalWorkspaceState: Equatable, Codable, Sendable {
  let id: TerminalWorkspaceID
  var updatedAt: UInt64
  var name: String
  var tabs: [PersistedTerminalTab]
  var selectedTabID: TerminalTabID?

  init(
    id: TerminalWorkspaceID = TerminalWorkspaceID(),
    updatedAt: UInt64 = PersistedTerminalSessionCatalog.currentTimestamp(),
    name: String,
    tabs: [PersistedTerminalTab] = [],
    selectedTabID: TerminalTabID? = nil
  ) {
    self.id = id
    self.updatedAt = updatedAt
    self.name = name
    self.tabs = tabs
    self.selectedTabID = selectedTabID
  }
}

extension PersistedTerminalWorkspaceState {
  var catalogWorkspace: PersistedTerminalWorkspace {
    PersistedTerminalWorkspace(id: id, name: name)
  }
}

extension PersistedTerminalSessionCatalog {
  static func merged(
    base: Self,
    incoming: Self
  ) -> Self {
    let workspacesByID = Dictionary(uniqueKeysWithValues: base.workspaces.map { ($0.id, $0) })
    let incomingByID = Dictionary(uniqueKeysWithValues: incoming.workspaces.map { ($0.id, $0) })
    let orderedWorkspaceIDs = mergedIDs(
      preferred:
        (incoming.workspaces.map(\.updatedAt).max() ?? 0) >= (base.workspaces.map(\.updatedAt).max() ?? 0)
        ? incoming.workspaces.map(\.id)
        : base.workspaces.map(\.id),
      fallback: Array(Set(workspacesByID.keys).union(incomingByID.keys))
    )

    let mergedWorkspaces = orderedWorkspaceIDs.compactMap { workspaceID -> PersistedTerminalWorkspaceState? in
      switch (workspacesByID[workspaceID], incomingByID[workspaceID]) {
      case (.some(let baseWorkspace), .some(let incomingWorkspace)):
        return PersistedTerminalWorkspaceState.merged(base: baseWorkspace, incoming: incomingWorkspace)
      case (.some(let workspace), .none), (.none, .some(let workspace)):
        return workspace
      case (.none, .none):
        return nil
      }
    }

    let (defaultSelectedWorkspaceID, selectionUpdatedAt) =
      incoming.selectionUpdatedAt >= base.selectionUpdatedAt
      ? (incoming.defaultSelectedWorkspaceID, incoming.selectionUpdatedAt)
      : (base.defaultSelectedWorkspaceID, base.selectionUpdatedAt)

    return sanitized(
      Self(
        defaultSelectedWorkspaceID: defaultSelectedWorkspaceID,
        selectionUpdatedAt: selectionUpdatedAt,
        workspaces: mergedWorkspaces,
        workspaceTombstones: mergedTombstones(base.workspaceTombstones, incoming.workspaceTombstones),
        tabTombstones: mergedTombstones(base.tabTombstones, incoming.tabTombstones),
        paneTombstones: mergedTombstones(base.paneTombstones, incoming.paneTombstones)
      )
    )
  }

  fileprivate static func mergedIDs<ID: Hashable>(
    preferred: [ID],
    fallback: [ID]
  ) -> [ID] {
    var seen = Set<ID>()
    var ordered: [ID] = []
    for id in preferred where seen.insert(id).inserted {
      ordered.append(id)
    }
    for id in fallback where seen.insert(id).inserted {
      ordered.append(id)
    }
    return ordered
  }

  fileprivate static func mergedTombstones<T: PersistedTerminalTombstoneProtocol>(
    _ base: [T],
    _ incoming: [T]
  ) -> [T] {
    let merged = Dictionary(
      incoming.map { ($0.id, $0) },
      uniquingKeysWith: { lhs, rhs in lhs.deletedAt >= rhs.deletedAt ? lhs : rhs }
    ).merging(
      Dictionary(
        uniqueKeysWithValues: base.map { ($0.id, $0) }
      ),
      uniquingKeysWith: { lhs, rhs in lhs.deletedAt >= rhs.deletedAt ? lhs : rhs }
    )
    return merged.values.sorted { $0.deletedAt < $1.deletedAt }
  }
}

extension PersistedTerminalWorkspaceState {
  static func merged(
    base: Self,
    incoming: Self
  ) -> Self {
    let baseTabs = Dictionary(uniqueKeysWithValues: base.tabs.map { ($0.id, $0) })
    let incomingTabs = Dictionary(uniqueKeysWithValues: incoming.tabs.map { ($0.id, $0) })
    let preferredTabs = (incoming.updatedAt >= base.updatedAt ? incoming.tabs : base.tabs).map(\.id)
    let tabIDs = PersistedTerminalSessionCatalog.mergedIDs(
      preferred: preferredTabs,
      fallback: Array(Set(baseTabs.keys).union(incomingTabs.keys))
    )

    return Self(
      id: incoming.updatedAt >= base.updatedAt ? incoming.id : base.id,
      updatedAt: max(base.updatedAt, incoming.updatedAt),
      name: incoming.updatedAt >= base.updatedAt ? incoming.name : base.name,
      tabs: tabIDs.compactMap { tabID in
        switch (baseTabs[tabID], incomingTabs[tabID]) {
        case (.some(let baseTab), .some(let incomingTab)):
          return PersistedTerminalTab.merged(base: baseTab, incoming: incomingTab)
        case (.some(let tab), .none), (.none, .some(let tab)):
          return tab
        case (.none, .none):
          return nil
        }
      },
      selectedTabID: incoming.updatedAt >= base.updatedAt ? incoming.selectedTabID : base.selectedTabID
    )
  }
}

extension PersistedTerminalTab {
  static func merged(
    base: Self,
    incoming: Self
  ) -> Self {
    let basePanes = Dictionary(uniqueKeysWithValues: base.panes.map { ($0.id, $0) })
    let incomingPanes = Dictionary(uniqueKeysWithValues: incoming.panes.map { ($0.id, $0) })
    let preferredPanes = (incoming.updatedAt >= base.updatedAt ? incoming.panes : base.panes).map(\.id)
    let paneIDs = PersistedTerminalSessionCatalog.mergedIDs(
      preferred: preferredPanes,
      fallback: Array(Set(basePanes.keys).union(incomingPanes.keys))
    )

    return Self(
      id: incoming.updatedAt >= base.updatedAt ? incoming.id : base.id,
      updatedAt: max(base.updatedAt, incoming.updatedAt),
      title: incoming.updatedAt >= base.updatedAt ? incoming.title : base.title,
      icon: incoming.updatedAt >= base.updatedAt ? incoming.icon : base.icon,
      isPinned: incoming.updatedAt >= base.updatedAt ? incoming.isPinned : base.isPinned,
      isTitleLocked: incoming.updatedAt >= base.updatedAt ? incoming.isTitleLocked : base.isTitleLocked,
      selectedPaneID: incoming.updatedAt >= base.updatedAt ? incoming.selectedPaneID : base.selectedPaneID,
      panes: paneIDs.compactMap { paneID in
        switch (basePanes[paneID], incomingPanes[paneID]) {
        case (.some(let basePane), .some(let incomingPane)):
          return PersistedTerminalPane.merged(base: basePane, incoming: incomingPane)
        case (.some(let pane), .none), (.none, .some(let pane)):
          return pane
        case (.none, .none):
          return nil
        }
      },
      splitTree: incoming.updatedAt >= base.updatedAt ? incoming.splitTree : base.splitTree
    )
  }
}

extension PersistedTerminalPane {
  static func merged(
    base: Self,
    incoming: Self
  ) -> Self {
    incoming.updatedAt >= base.updatedAt ? incoming : base
  }
}

extension PersistedTerminalSplitTree.Node {
  var leftmostPaneID: UUID? {
    switch self {
    case .leaf(let paneID):
      return paneID
    case .split(let split):
      return split.left.leftmostPaneID
    }
  }
}

protocol PersistedTerminalTombstoneProtocol: Equatable, Codable, Sendable {
  associatedtype ID: Hashable & Sendable
  var id: ID { get }
  var deletedAt: UInt64 { get }
}

nonisolated struct PersistedTerminalWorkspaceTombstone: PersistedTerminalTombstoneProtocol {
  var id: TerminalWorkspaceID
  var deletedAt: UInt64
}

nonisolated struct PersistedTerminalTabTombstone: PersistedTerminalTombstoneProtocol {
  var id: TerminalTabID
  var deletedAt: UInt64
}

nonisolated struct PersistedTerminalPaneTombstone: PersistedTerminalTombstoneProtocol {
  var id: UUID
  var deletedAt: UInt64
}
