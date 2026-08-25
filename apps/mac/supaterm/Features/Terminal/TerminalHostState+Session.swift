import Foundation
import GhosttyKit
import SupatermSupport

extension TerminalHostState {
  func restorationSnapshot() -> TerminalWindowSession {
    TerminalWindowSession(
      displayedSpaceID: displayedSpaceID,
      spaces: spaceManager.instances.map(restorationSnapshot(for:))
    )
  }

  private func restorationSnapshot(for instance: TerminalSpaceInstance) -> TerminalSpaceSession {
    if let pendingSession = instance.pendingSession { return pendingSession }
    let tabs = instance.tabCollection.canonicalTabs.compactMap(restorationTabSession(for:))
    let tabIDs = Set(tabs.map(\.id))
    return TerminalSpaceSession(
      spaceID: instance.spaceID,
      selectedTabID: instance.selectedTabID.flatMap { tabIDs.contains($0) ? $0 : nil }
        ?? tabs.first?.id,
      collapsedProjectIDs: projectCatalog.projects.map(\.id).filter(
        instance.collapsedProjectIDs.contains
      ),
      isUnassignedCollapsed: instance.isUnassignedCollapsed,
      tabs: tabs
    )
  }

  @discardableResult
  func restore(from session: TerminalWindowSession) -> Bool {
    guard managesTerminalSurfaces else { return false }
    let validSpaceIDs = Set(spaces.map(\.id))
    let allowsExistingSessions = zmxSessionsEnabled && zmxClient.executableURL() != nil
    guard
      let session = session.pruned(
        validSpaceIDs: validSpaceIDs,
        allowsExistingSessions: allowsExistingSessions
      )
    else { return false }
    return withSessionChangesSuppressed { restorePrunedSession(session) }
  }

  func restorePrunedSession(_ session: TerminalWindowSession) -> Bool {
    clearSessionState()
    guard let displayedSession = session.displayedSpace else {
      logRestoreFailed(reason: "displayedSpaceMissing")
      return false
    }
    for space in session.spaces where space.spaceID != displayedSession.spaceID {
      if space.containsExistingSession {
        restoreSpaceSession(space)
      } else {
        spaceManager.registerColdInstance(space)
      }
    }
    restoreSpaceSession(displayedSession)
    return finalizeRestoredSession(displayedSession)
  }

  func restoreSpaceSession(_ session: TerminalSpaceSession) {
    let instance = spaceManager.instance(warming: session.spaceID)
    instance.collapsedProjectIDs = Set(session.collapsedProjectIDs)
    instance.isUnassignedCollapsed = session.isUnassignedCollapsed
    let items = session.tabs.enumerated().map { restoredTabItem(for: $0.element, at: $0.offset) }
    spaceManager.restoreTabs(items, selectedTabID: session.selectedTabID, in: session.spaceID)
    for tab in session.tabs { restoreTabSession(tab, in: session.spaceID) }
  }

  func finalizeRestoredSession(_ session: TerminalSpaceSession) -> Bool {
    guard !spaceManager.allTabs.isEmpty || !spaceManager.pendingSurfaceIDs.isEmpty else {
      logRestoreFailed(reason: "noRestoredItems")
      clearSessionState()
      return false
    }
    guard displayedSpaceID == session.spaceID else {
      logRestoreFailed(reason: "displayedSpaceMissing")
      clearSessionState()
      return false
    }
    if spaceManager.tabs(in: session.spaceID).isEmpty {
      _ = createTab(
        in: session.spaceID,
        focusing: false,
        sessionChangesEnabled: false,
        synchronizesFocus: false
      )
    }
    if let selectedTabID { focusSurface(in: selectedTabID) }
    syncFocus(windowActivity)
    logRestoreFinished(session.spaceID)
    return true
  }

  func restorationTabSession(for tab: TerminalTabItem) -> TerminalTabSession? {
    guard let tree = trees[tab.id], let root = tree.root.map(restorationNode(for:)) else {
      return nil
    }
    let focusedPaneIndex =
      focusHistoryByTab[tab.id].map(\.current).flatMap { focusedPaneID in
        tree.leaves().firstIndex(where: { $0.id == focusedPaneID })
      } ?? 0
    return TerminalTabSession(
      id: tab.id,
      projectID: tab.projectID,
      isPinned: tab.isPinned,
      lockedTitle: lockedTabTitle(for: tab.id),
      focusedPaneIndex: focusedPaneIndex,
      root: root
    )
  }

  func restorationNode(for node: SplitTree<GhosttySurfaceView>.Node) -> TerminalPaneNodeSession {
    switch node {
    case .leaf(let surface):
      return .leaf(
        TerminalPaneLeafSession(
          id: surface.id,
          workingDirectoryPath: workingDirectoryPath(for: surface),
          titleOverride: surface.bridge.state.titleOverride,
          agents: agentStateRecords(for: surface.id),
          restoreMode: surface.restoreMode
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

  func restoredTabItem(for session: TerminalTabSession, at index: Int) -> TerminalTabItem {
    TerminalTabItem(
      id: session.id,
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      projectID: session.projectID,
      isPinned: session.isPinned,
      isTitleLocked: session.lockedTitle != nil
    )
  }

  func restoredTabTitle(at index: Int) -> String {
    index == 0 ? "Terminal" : "Terminal \(index + 1)"
  }

  func restoreTabSession(_ session: TerminalTabSession, in spaceID: TerminalSpaceID) {
    let tabID = session.id
    let context: ghostty_surface_context_e =
      spaceManager.tabs(in: spaceID).first?.id == tabID
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let restoredRoot = restoreNode(session.root, in: tabID, context: context)
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
      let zmxAttachMode: ZmxAttach.Mode =
        leaf.restoreMode == .existingSession
        ? .existing
        : .createIfNeeded
      let surface = createSurface(
        tabID: tabID,
        startupCommand: nil,
        inheritingFromSurfaceID: nil,
        workingDirectory: existingWorkingDirectoryURL(for: leaf.workingDirectoryPath),
        context: context,
        surfaceID: leaf.id,
        restoreMode: leaf.restoreMode,
        zmxAttachMode: zmxAttachMode
      )
      surface.bridge.state.titleOverride = leaf.titleOverride
      restoreAgentState(leaf.agents, for: surface.id)
      return .leaf(view: surface)
    case .split(let split):
      return .split(
        SplitTree<GhosttySurfaceView>.Split(
          direction: mapSplitDirection(split.direction),
          ratio: split.ratio,
          left: restoreNode(split.left, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT),
          right: restoreNode(split.right, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
        )
      )
    }
  }

  func clearSessionState() {
    removeTrees(
      for: spaceManager.allTabs.map(\.id),
      terminateSessions: false,
      source: .sessionClear
    )
    for instance in spaceManager.instances {
      instance.tabCollection.restoreTabs([], selectedTabID: nil)
      instance.collapsedProjectIDs.removeAll()
      instance.isUnassignedCollapsed = false
      instance.previousSelectedTabID = nil
      instance.pendingSession = nil
    }
    for tabID in focusHistoryByTab.keys { focusHistoryByTab[tabID]?.previous = nil }
  }

  func restoreAgentState(_ records: [TerminalPaneAgentRecord], for surfaceID: UUID) {
    let snapshots = records.compactMap { record -> TerminalAgentStateSnapshot? in
      let processes = Set(record.processes.filter(TerminalAgentProcessInspector.isCurrent))
      return processes.isEmpty ? nil : record.snapshot(surfaceID: surfaceID, processes: processes)
    }
    if !snapshots.isEmpty {
      agentStateStore.restore(snapshots)
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
  }

  func sessionDidChange() {
    guard suppressesSessionChanges == 0 else { return }
    onSessionChange()
  }

  func withSessionChangesSuppressed<Result>(_ body: () -> Result) -> Result {
    suppressesSessionChanges += 1
    defer { suppressesSessionChanges -= 1 }
    return body()
  }

  func withBatchedSessionChange<Result>(_ body: () -> Result) -> Result {
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
    guard
      FileManager.default.fileExists(atPath: normalizedPath, isDirectory: &isDirectory),
      isDirectory.boolValue
    else { return nil }
    return URL(fileURLWithPath: normalizedPath, isDirectory: true)
  }

  func logRestoreFailed(reason: String) {
    SupatermLog.error(SupatermLog.terminal, "terminal.session.restore.failed", fields: ["reason=\(reason)"])
  }

  func logRestoreFinished(_ displayedSpaceID: TerminalSpaceID) {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.restore.finished",
      fields: ["displayedSpaceID=\(SupatermLog.uuid(displayedSpaceID.rawValue))"]
    )
  }
}
