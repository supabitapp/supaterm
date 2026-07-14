import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SwiftUI

extension TerminalHostState {
  func restorationSnapshot() -> TerminalWindowSession {
    let spaces = spaces.map { space in
      let projects = spaceManager.projectGroups(in: space.id).map { group in
        TerminalWindowProjectSession(
          id: group.projectID,
          tabs: group.tabs.compactMap { tab in
            guard !tab.isPinned else { return nil }
            guard let session = restorationTabSession(for: tab) else { return nil }
            return PersistedTerminalTab(id: tab.id, session: session)
          }
        )
      }
      return TerminalWindowSpaceSession(
        id: space.id,
        selectedTabID: spaceManager.selectedTabID(in: space.id),
        projects: projects
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
    restoreTabItems(from: session)
    restorePaneSessions(from: session)
    return finalizeRestoredSession(session)
  }

  func restoreTabItems(from session: TerminalWindowSession) {
    let sessionsBySpaceID = Dictionary(uniqueKeysWithValues: session.spaces.map { ($0.id, $0) })
    var selectedTabIDsBySpaceID: [TerminalSpaceID: TerminalTabID] = [:]

    for space in spaces {
      let spaceSession = sessionsBySpaceID[space.id]
      let restoredGroups = restoredTabGroups(for: spaceSession)
      if let selectedTabID = spaceSession?.selectedTabID {
        selectedTabIDsBySpaceID[space.id] = selectedTabID
      }
      _ = spaceManager.restoreTabs(
        restoredGroups,
        selectedTabID: spaceSession?.selectedTabID,
        in: space.id
      )
    }

    reconcilePinnedTabs(
      with: pinnedTabCatalog,
      selectedTabIDsBySpaceID: selectedTabIDsBySpaceID
    )
  }

  func restoredTabGroups(for spaceSession: TerminalWindowSpaceSession?) -> [TerminalProjectTabs] {
    spaceSession?.projects.map { project in
      TerminalProjectTabs(
        projectID: project.id,
        tabs: project.tabs.enumerated().map { index, tab in
          restoredTabItem(for: tab.session, id: tab.id, at: index, isPinned: false)
        }
      )
    } ?? []
  }

  func restorePaneSessions(from session: TerminalWindowSession) {
    for spaceSession in session.spaces {
      for projectSession in spaceSession.projects {
        guard spaceManager.projects(in: spaceSession.id).contains(where: { $0.id == projectSession.id }) else {
          continue
        }
        for tab in projectSession.tabs {
          guard spaceManager.tab(for: tab.id) != nil else { continue }
          restoreTabSession(tab.session, tabID: tab.id, in: spaceSession.id)
        }
      }
    }
  }

  func finalizeRestoredSession(_ session: TerminalWindowSession) -> Bool {
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
    at index: Int,
    isPinned: Bool
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: id,
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      isPinned: isPinned,
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
      _ = spaceManager.restoreTabs(
        spaceManager.projects(in: space.id).map { TerminalProjectTabs(projectID: $0.id, tabs: []) },
        selectedTabID: nil,
        in: space.id
      )
    }
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

  func sessionDidChange(persistingPinnedTabLayouts: Bool = true) {
    guard suppressesSessionChanges == 0 else { return }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.session.didChange",
      fields: [
        "persistingPinnedTabLayouts=\(persistingPinnedTabLayouts)",
        "spaces=\(spaces.count)",
        "tabs=\(spaces.reduce(0) { $0 + spaceManager.tabs(in: $1.id).count })",
        "surfaces=\(surfaces.count)",
      ]
    )
    if persistingPinnedTabLayouts {
      persistLivePinnedTabLayouts()
    }
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
