import AppKit
import Foundation
import GhosttyKit
import SupatermSupport

private struct RestoredTerminalSpace {
  let rootItems: [TerminalTabRootItem]
  let tabs: [TerminalTabSession]
}

private struct TerminalRootSessionSnapshot {
  let nodes: [TerminalTabNodeSession]
  let group: TerminalTabGroupSession?
  let tabs: [TerminalTabSession]
}

extension TerminalHostState {
  func restorationSnapshot() -> TerminalWindowSession {
    let spaces = spaces.map { space in
      var rootOrderByPinned = [true: 0, false: 0]
      var rootSnapshots: [TerminalRootSessionSnapshot] = []
      for item in spaceManager.rootItems(in: space.id) {
        let rootOrder = rootOrderByPinned[item.isPinned, default: 0]
        guard let snapshot = restorationSnapshot(for: item, rootOrder: rootOrder) else {
          continue
        }
        rootSnapshots.append(snapshot)
        rootOrderByPinned[item.isPinned] = rootOrder + 1
      }
      let tabs = rootSnapshots.flatMap(\.tabs)
      let tabIDs = Set(tabs.map(\.id))
      let selectedTabID =
        spaceManager.selectedTabID(in: space.id).flatMap {
          tabIDs.contains($0) ? $0 : nil
        } ?? tabs.first?.id
      return TerminalWindowSpaceSession(
        id: space.id,
        selectedTabID: selectedTabID,
        nodes: rootSnapshots.flatMap(\.nodes),
        groups: rootSnapshots.compactMap(\.group),
        collapsedGroupIDs: rootSnapshots.compactMap(\.group).map(\.id).filter {
          collapsedTabGroupIDsBySpace[space.id]?.contains($0) == true
        },
        tabs: tabs
      )
    }

    let resolvedSelectedSpaceID =
      self.selectedSpaceID.flatMap { selectedSpaceID in
        spaces.contains(where: { $0.id == selectedSpaceID }) ? selectedSpaceID : nil
      }
      ?? spaces.first?.id
      ?? spaceCatalog.defaultSelectedSpaceID

    return TerminalWindowSession(
      selectedSpaceID: resolvedSelectedSpaceID,
      spaces: spaces
    )
  }

  @discardableResult
  func restore(from session: TerminalWindowSession) -> Bool {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.restore.requested",
      fields: [
        "spaces=\(session.spaces.count)",
        "surfaces=\(session.surfaceIDs.count)",
      ]
    )
    guard managesTerminalSurfaces else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.session.restore.skipped",
        fields: ["reason=unmanagedSurfaces"]
      )
      return false
    }
    let validSpaceIDs = Set(spaces.map(\.id))
    guard let session = session.pruned(validSpaceIDs: validSpaceIDs) else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.session.restore.skipped",
        fields: ["reason=emptyAfterPrune", "validSpaces=\(validSpaceIDs.count)"]
      )
      return false
    }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.restore.pruned",
      fields: [
        "spaces=\(session.spaces.count)",
        "surfaces=\(session.surfaceIDs.count)",
      ]
    )

    return withSessionChangesSuppressed {
      restorePrunedSession(session)
    }
  }

  func restorePrunedSession(_ session: TerminalWindowSession) -> Bool {
    clearSessionState()
    let restoredSpaces = restoreTabItems(from: session)
    restorePaneSessions(restoredSpaces)
    return finalizeRestoredSession(session)
  }

  private func restorationSnapshot(
    for item: TerminalTabRootItem,
    rootOrder: Int
  ) -> TerminalRootSessionSnapshot? {
    switch item {
    case .tab(let item):
      guard let tab = restorationTabSession(for: item.tab) else { return nil }
      return TerminalRootSessionSnapshot(
        nodes: [
          TerminalTabNodeSession(
            item: .tab(item.tab.id),
            parent: .root(isPinned: item.isPinned),
            order: rootOrder
          )
        ],
        group: nil,
        tabs: [tab]
      )
    case .group(let group):
      let tabs = group.tabs.compactMap(restorationTabSession(for:))
      return TerminalRootSessionSnapshot(
        nodes: [
          TerminalTabNodeSession(
            item: .group(group.id),
            parent: .root(isPinned: group.isPinned),
            order: rootOrder
          )
        ]
          + tabs.enumerated().map { order, tab in
            TerminalTabNodeSession(
              item: .tab(tab.id),
              parent: .group(group.id),
              order: order
            )
          },
        group: TerminalTabGroupSession(
          id: group.id,
          title: group.title,
          color: group.color,
          lifetime: group.lifetime
        ),
        tabs: tabs
      )
    }
  }

  private func restoreTabItems(
    from session: TerminalWindowSession
  ) -> [TerminalSpaceID: RestoredTerminalSpace] {
    let sessionsBySpaceID = Dictionary(uniqueKeysWithValues: session.spaces.map { ($0.id, $0) })
    var restoredSpaces: [TerminalSpaceID: RestoredTerminalSpace] = [:]

    for space in spaces {
      let spaceSession = sessionsBySpaceID[space.id]
      let restoredSpace = restoredSpace(for: spaceSession)
      restoredSpaces[space.id] = restoredSpace
      collapsedTabGroupIDsBySpace[space.id] = Set(spaceSession?.collapsedGroupIDs ?? [])
      _ = spaceManager.restoreRootItems(
        restoredSpace.rootItems,
        selectedTabID: spaceSession?.selectedTabID,
        in: space.id
      )
    }

    return restoredSpaces
  }

  private func restoredSpace(
    for spaceSession: TerminalWindowSpaceSession?
  ) -> RestoredTerminalSpace {
    guard let spaceSession else {
      return RestoredTerminalSpace(rootItems: [], tabs: [])
    }
    let tabSessionsByID = Dictionary(uniqueKeysWithValues: spaceSession.tabs.map { ($0.id, $0) })
    let groupSessionsByID = Dictionary(uniqueKeysWithValues: spaceSession.groups.map { ($0.id, $0) })
    var tabNodesByGroupID: [TerminalTabGroupID: [TerminalTabNodeSession]] = [:]
    for node in spaceSession.nodes {
      guard let groupID = node.parent.groupID else { continue }
      tabNodesByGroupID[groupID, default: []].append(node)
    }
    tabNodesByGroupID = tabNodesByGroupID.mapValues { $0.sorted { $0.order < $1.order } }
    let rootNodes = spaceSession.nodes.filter { $0.parent.isPinned != nil }.sorted {
      let lhsLane = $0.parent.isPinned == true ? 0 : 1
      let rhsLane = $1.parent.isPinned == true ? 0 : 1
      return (lhsLane, $0.order) < (rhsLane, $1.order)
    }
    var restoredTabs: [TerminalTabSession] = []
    let rootItems = rootNodes.compactMap { node -> TerminalTabRootItem? in
      switch node.item {
      case .tab(let id):
        guard let session = tabSessionsByID[id] else { return nil }
        let tab = restoredTabItem(for: session, at: restoredTabs.count)
        restoredTabs.append(session)
        return .tab(
          TerminalUngroupedTabItem(
            tab: tab,
            isPinned: node.parent.isPinned == true
          )
        )
      case .group(let id):
        guard let group = groupSessionsByID[id] else { return nil }
        let tabs = (tabNodesByGroupID[id] ?? []).compactMap { node -> TerminalTabItem? in
          guard let tabID = node.item.tabID else { return nil }
          guard let session = tabSessionsByID[tabID] else { return nil }
          let tab = restoredTabItem(for: session, at: restoredTabs.count)
          restoredTabs.append(session)
          return tab
        }
        return .group(
          TerminalTabGroupItem(
            id: id,
            title: group.title,
            color: group.color,
            isPinned: node.parent.isPinned == true,
            tabs: tabs,
            lifetime: group.lifetime
          )
        )
      }
    }
    return RestoredTerminalSpace(rootItems: rootItems, tabs: restoredTabs)
  }

  private func restorePaneSessions(
    _ restoredSpaces: [TerminalSpaceID: RestoredTerminalSpace]
  ) {
    for (spaceID, restoredSpace) in restoredSpaces {
      for tab in restoredSpace.tabs {
        restoreTabSession(tab, in: spaceID)
      }
    }
  }

  func finalizeRestoredSession(_ session: TerminalWindowSession) -> Bool {
    guard spaces.contains(where: { !spaceManager.rootItems(in: $0.id).isEmpty }) else {
      logRestoreFailed(reason: "noRestoredItems")
      clearSessionState()
      return false
    }

    let selectedSpaceID =
      spaces.contains(where: { $0.id == session.selectedSpaceID })
      ? session.selectedSpaceID
      : spaces.first?.id
    guard let selectedSpaceID, applySelectedSpace(selectedSpaceID) else {
      logRestoreFailed(reason: "selectedSpaceMissing")
      clearSessionState()
      return false
    }

    if spaceManager.tabs(in: selectedSpaceID).isEmpty {
      _ = createTab(
        in: selectedSpaceID,
        focusing: false,
        sessionChangesEnabled: false,
        synchronizesFocus: false
      )
    }
    finalizeRestoredSelection()
    logRestoreFinished(selectedSpaceID)
    return true
  }

  func finalizeRestoredSelection() {
    if let selectedTabID {
      focusSurface(in: selectedTabID)
    } else {
      lastEmittedFocusSurfaceID = nil
    }
    syncFocus(windowActivity)
  }

  func logRestoreFailed(reason: String) {
    SupatermLog.error(
      SupatermLog.terminal,
      "terminal.session.restore.failed",
      fields: ["reason=\(reason)"]
    )
  }

  func logRestoreFinished(_ selectedSpaceID: TerminalSpaceID) {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.restore.finished",
      fields: [
        "selectedSpaceID=\(SupatermLog.uuid(selectedSpaceID.rawValue))",
        "selectedTabID=\(SupatermLog.uuid(self.selectedTabID?.rawValue))",
        "tabs=\(spaces.reduce(0) { $0 + spaceManager.tabs(in: $1.id).count })",
        "surfaces=\(surfaces.count)",
      ]
    )
  }

  func restorationTabSession(for tab: TerminalTabItem) -> TerminalTabSession? {
    guard let tree = trees[tab.id], let root = tree.root.map(restorationNode(for:)) else {
      return nil
    }
    let focusedPaneIndex =
      focusHistoryByTab[tab.id].map(\.current).flatMap { focusedPaneID in
        tree.leaves().firstIndex(where: { $0.id == focusedPaneID })
      }
      ?? 0
    return TerminalTabSession(
      id: tab.id,
      lockedTitle: lockedTabTitle(for: tab.id),
      focusedPaneIndex: focusedPaneIndex,
      root: root
    )
  }

  func restorationNode(
    for node: SplitTree<GhosttySurfaceView>.Node
  ) -> TerminalPaneNodeSession {
    switch node {
    case .leaf(let surface):
      return .leaf(
        TerminalPaneLeafSession(
          id: surface.id,
          workingDirectoryPath: workingDirectoryPath(for: surface),
          titleOverride: surface.bridge.state.titleOverride,
          agents: agentStateRecords(for: surface.id)
        )
      )
    case .split(let split):
      return .split(
        TerminalPaneSplitSession(
          direction: mapSessionSplitDirection(split.direction),
          ratio: split.ratio,
          left: restorationNode(for: split.left),
          right: restorationNode(for: split.right)
        )
      )
    }
  }

  func restoredTabItem(
    for session: TerminalTabSession,
    at index: Int
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: session.id,
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      isTitleLocked: session.lockedTitle != nil
    )
  }

  func restoredTabTitle(at index: Int) -> String {
    index == 0 ? "Terminal" : "Terminal \(index + 1)"
  }

  func restoreTabSession(
    _ session: TerminalTabSession,
    in spaceID: TerminalSpaceID
  ) {
    let tabID = session.id
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.restoreTab",
      fields: [
        "spaceID=\(SupatermLog.uuid(spaceID.rawValue))",
        "tabID=\(SupatermLog.uuid(tabID.rawValue))",
        "surfaces=\(session.surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(session.surfaceIDs))",
      ]
    )
    let context: ghostty_surface_context_e =
      spaceManager.tabs(in: spaceID).first?.id == tabID
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let restoredRoot = restoreNode(
      session.root,
      in: tabID,
      context: context
    )
    trees[tabID] = SplitTree(root: restoredRoot, zoomed: nil)
    let leaves = restoredRoot.leaves()
    let focusedPaneIndex =
      leaves.indices.contains(session.focusedPaneIndex)
      ? session.focusedPaneIndex
      : 0
    applyFocusedSurface(leaves[focusedPaneIndex].id, in: tabID)
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
  }

  func restoreNode(
    _ node: TerminalPaneNodeSession,
    in tabID: TerminalTabID,
    context: ghostty_surface_context_e
  ) -> SplitTree<GhosttySurfaceView>.Node {
    switch node {
    case .leaf(let leaf):
      let surface = createSurface(
        tabID: tabID,
        startupCommand: nil,
        inheritingFromSurfaceID: nil,
        workingDirectory: existingWorkingDirectoryURL(for: leaf.workingDirectoryPath),
        context: context,
        surfaceID: leaf.id
      )
      surface.bridge.state.titleOverride = leaf.titleOverride
      restoreAgentState(leaf.agents, for: surface.id)
      return .leaf(view: surface)

    case .split(let split):
      let left = restoreNode(split.left, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      let right = restoreNode(split.right, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      return .split(
        SplitTree<GhosttySurfaceView>.Split(
          direction: mapSplitDirection(split.direction),
          ratio: split.ratio,
          left: left,
          right: right
        )
      )
    }
  }

  func clearSessionState() {
    let existingTabIDs = spaces.flatMap { spaceManager.tabs(in: $0.id).map(\.id) }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.clear",
      fields: [
        "tabs=\(existingTabIDs.count)",
        "surfaces=\(surfaces.count)",
      ]
    )
    removeTrees(for: existingTabIDs, terminateSessions: false, source: .sessionClear)
    for space in spaces {
      _ = spaceManager.restoreRootItems([], selectedTabID: nil, in: space.id)
    }
    collapsedTabGroupIDsBySpace.removeAll()
    for tabID in focusHistoryByTab.keys {
      focusHistoryByTab[tabID]?.previous = nil
    }
    previousSelectedTabIDBySpace.removeAll()
    previousSelectedSpaceID = nil
    lastEmittedFocusSurfaceID = nil
  }

  func restoreAgentState(
    _ records: [TerminalPaneAgentRecord],
    for surfaceID: UUID
  ) {
    var snapshots: [TerminalAgentStateSnapshot] = []
    for record in records {
      let processes = Set(record.processes.filter(TerminalAgentProcessInspector.isCurrent))
      guard !processes.isEmpty else { continue }
      snapshots.append(record.snapshot(surfaceID: surfaceID, processes: processes))
    }
    if !snapshots.isEmpty {
      agentStateStore.restore(snapshots)
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
  }

  func sessionDidChange() {
    guard suppressesSessionChanges == 0 else { return }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.didChange",
      fields: [
        "spaces=\(spaces.count)",
        "tabs=\(spaces.reduce(0) { $0 + spaceManager.tabs(in: $1.id).count })",
        "surfaces=\(surfaces.count)",
      ]
    )
    onSessionChange()
  }

  func withSessionChangesSuppressed<Result>(
    _ body: () -> Result
  ) -> Result {
    suppressesSessionChanges += 1
    defer {
      suppressesSessionChanges -= 1
    }
    return body()
  }

  func withBatchedSessionChange<Result>(
    _ body: () -> Result
  ) -> Result {
    let result = withSessionChangesSuppressed(body)
    sessionDidChange()
    return result
  }

  func workingDirectoryPath(for surface: GhosttySurfaceView) -> String? {
    guard let path = Self.trimmedNonEmpty(surface.bridge.state.pwd) else { return nil }
    return GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
  }

  func existingWorkingDirectoryURL(for path: String?) -> URL? {
    guard let path = Self.trimmedNonEmpty(path) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: normalizedPath, isDirectory: &isDirectory) else {
      return nil
    }
    guard isDirectory.boolValue else { return nil }
    return URL(fileURLWithPath: normalizedPath, isDirectory: true)
  }
}
