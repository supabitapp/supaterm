import AppKit
import Foundation
import GhosttyKit
import SupatermSupport

private struct RestoredTerminalTab {
  let sourceIndex: Int
  let id: TerminalTabID
  let session: TerminalTabSession
}

private struct RestoredTerminalSpace {
  let rootItems: [TerminalTabRootItem]
  let tabs: [RestoredTerminalTab]
}

private struct TerminalRootSessionSnapshot {
  let item: TerminalTabRootSessionItem
  let tabIDs: [TerminalTabID]
}

extension TerminalHostState {
  func restorationSnapshot() -> TerminalWindowSession {
    let spaces = spaces.map { space in
      let rootSnapshots = spaceManager.rootItems(in: space.id).compactMap(restorationSnapshot(for:))
      let rootItems = rootSnapshots.map(\.item)
      let tabIDs = rootSnapshots.flatMap(\.tabIDs)
      let selectedTabIndex = spaceManager.selectedTabID(in: space.id).flatMap {
        tabIDs.firstIndex(of: $0)
      }
      let collapsedGroupIDs = rootItems.compactMap(\.groupID).filter {
        collapsedTabGroupIDsBySpace[space.id]?.contains($0) == true
      }
      return TerminalWindowSpaceSession(
        id: space.id,
        selectedTabIndex: selectedTabIndex ?? (tabIDs.isEmpty ? nil : 0),
        collapsedGroupIDs: collapsedGroupIDs,
        rootItems: rootItems
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
    for item: TerminalTabRootItem
  ) -> TerminalRootSessionSnapshot? {
    switch item {
    case .tab(let item):
      guard let tab = restorationTabSession(for: item.tab) else { return nil }
      return TerminalRootSessionSnapshot(
        item: .tab(isPinned: item.isPinned, tab: tab),
        tabIDs: [item.tab.id]
      )
    case .group(let group):
      let snapshots = group.tabs.compactMap { tab in
        restorationTabSession(for: tab).map { (tab.id, $0) }
      }
      return TerminalRootSessionSnapshot(
        item: .group(
          id: group.id,
          title: group.title,
          color: group.color,
          isPinned: group.isPinned,
          tabs: snapshots.map(\.1)
        ),
        tabIDs: snapshots.map(\.0)
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
      let selectedTabID = spaceSession?.selectedTabIndex.flatMap { index in
        restoredSpace.tabs.first(where: { $0.sourceIndex == index })?.id
      }
      _ = spaceManager.restoreRootItems(
        restoredSpace.rootItems,
        selectedTabID: selectedTabID,
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
    var sourceIndex = 0
    var restoredTabs: [RestoredTerminalTab] = []
    let rootItems = spaceSession.rootItems.map { item -> TerminalTabRootItem in
      switch item {
      case .tab(let isPinned, let session):
        let tab = restoredTabItem(for: session, at: sourceIndex)
        restoredTabs.append(
          RestoredTerminalTab(sourceIndex: sourceIndex, id: tab.id, session: session)
        )
        sourceIndex += 1
        return .tab(TerminalUngroupedTabItem(tab: tab, isPinned: isPinned))
      case .group(let id, let title, let color, let isPinned, let sessions):
        let tabs = sessions.map { session -> TerminalTabItem in
          let tab = restoredTabItem(for: session, at: sourceIndex)
          restoredTabs.append(
            RestoredTerminalTab(sourceIndex: sourceIndex, id: tab.id, session: session)
          )
          sourceIndex += 1
          return tab
        }
        return .group(
          TerminalTabGroupItem(
            id: id,
            title: title,
            color: color,
            isPinned: isPinned,
            tabs: tabs
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
        restoreTabSession(tab.session, tabID: tab.id, in: spaceID)
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
    id: TerminalTabID = TerminalTabID(),
    at index: Int
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: id,
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      isTitleLocked: session.lockedTitle != nil
    )
  }

  func restoredTabTitle(at index: Int) -> String {
    index == 0 ? "Terminal" : "Terminal \(index + 1)"
  }

  func restoreTabSession(
    _ session: TerminalTabSession,
    tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
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
