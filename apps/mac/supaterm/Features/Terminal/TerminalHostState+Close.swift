import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermSupport
import SwiftUI

extension TerminalHostState {
  func closeSurface(_ surfaceID: UUID) {
    performCloseSurface(surfaceID, source: .commandCloseSurface)
  }

  func closeTab(_ tabID: TerminalTabID) {
    performCloseTab(tabID)
  }

  func closeGroup(_ groupID: TerminalTabGroupID) {
    performCloseGroup(groupID)
  }

  func closeTabs(_ tabIDs: [TerminalTabID]) {
    performCloseTabs(tabIDs)
  }

  func requestCloseSurface(
    _ surfaceID: UUID,
    needsConfirmation: Bool? = nil,
    source: TerminalSurfaceCloseSource = .commandRequestCloseSurface
  ) {
    guard
      let resolvedCloseRequest = resolvedCloseRequest(
        for: .surface(surfaceID),
        needsConfirmationOverride: needsConfirmation
      )
    else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.request.dropped",
        fields: [
          "source=\(source.rawValue)",
          "surfaceID=\(SupatermLog.uuid(surfaceID))",
          "reason=unresolved",
        ]
      )
      return
    }
    logCloseRequest(
      surfaceID: surfaceID,
      needsConfirmationOverride: needsConfirmation,
      resolvedCloseRequest: resolvedCloseRequest,
      source: source
    )
    emit(resolvedCloseRequest)
  }

  func requestCloseTab(_ tabID: TerminalTabID) {
    guard let tree = trees[tabID] else { return }
    let isZoomed = tree.zoomed != nil
    guard
      let resolvedCloseRequest = resolvedCloseRequest(
        for: .tab(tabID),
        needsConfirmationOverride: isZoomed ? true : nil
      )
    else {
      return
    }
    if isZoomed {
      trees[tabID] = tree.settingZoomed(nil)
    }
    emit(resolvedCloseRequest)
  }

  func requestCloseGroup(_ groupID: TerminalTabGroupID) {
    guard
      let space = spaceManager.space(for: groupID),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return
    }
    guard !manager.tabIDs(in: groupID).isEmpty else {
      _ = deleteEmptyGroup(groupID)
      return
    }
    guard let resolvedCloseRequest = resolvedCloseRequest(for: .group(groupID)) else { return }
    emit(resolvedCloseRequest)
  }

  func requestCloseTabsBelow(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    requestCloseTabs(tabManager.tabIDsBelow(tabID))
  }

  func requestCloseOtherTabs(keeping tabIDs: [TerminalTabID]) {
    guard let tabID = tabIDs.first, let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    let retained = Set(tabIDs)
    requestCloseTabs(tabManager.tabs.map(\.id).filter { !retained.contains($0) })
  }

  func requestCloseTabs(_ tabIDs: [TerminalTabID]) {
    guard let resolvedCloseRequest = resolvedCloseRequest(for: .tabs(tabIDs)) else { return }
    emit(resolvedCloseRequest)
  }

  func performCloseSurface(
    _ surfaceID: UUID,
    source: TerminalSurfaceCloseSource = .commandCloseSurface
  ) {
    guard let tabID = tabID(containing: surfaceID), let tree = trees[tabID] else {
      logClosePerformDropped(surfaceID: surfaceID, source: source, reason: "missingTree")
      return
    }
    guard let node = tree.find(id: surfaceID), let surface = surfaces[surfaceID] else {
      logClosePerformDropped(
        surfaceID: surfaceID,
        tabID: tabID,
        source: source,
        reason: "missingSurface"
      )
      return
    }
    let spaceID = spaceManager.space(for: tabID)?.id
    let wasPinned = isPinned(tabID)
    let wasSelectedSpace = selectedSpaceID == spaceID
    let wasSelectedTab = selectedTabID == tabID

    let nextSurface =
      focusHistoryByTab[tabID]?.current == surfaceID
      ? tree.focusTargetAfterClosing(node)
      : nil
    let newTree = tree.removing(node)
    logClosePerform(
      TerminalClosePerformLogContext(
        source: source,
        surfaceID: surfaceID,
        tabID: tabID,
        spaceID: spaceID,
        wasPinned: wasPinned,
        leafCount: tree.leaves().count,
        newTreeEmpty: newTree.isEmpty,
        focusedSurfaceID: focusHistoryByTab[tabID]?.current,
        nextSurfaceID: nextSurface?.id
      )
    )

    logCloseKillSurface(surfaceID: surfaceID, tabID: tabID, source: source)
    killZmxSession(for: surfaceID)
    cleanupSurface(surface)

    if newTree.isEmpty {
      trees.removeValue(forKey: tabID)
      focusHistoryByTab.removeValue(forKey: tabID)
      spaceManager.space(for: tabID)
        .flatMap { spaceManager.tabManager(for: $0.id) }?
        .closeTab(tabID)
      if let spaceID {
        updateSelectionAfterClosingTab(
          in: spaceID,
          wasSelectedSpace: wasSelectedSpace,
          didCloseSelectedTab: wasSelectedTab
        )
      } else {
        lastEmittedFocusSurfaceID = nil
      }
      syncFocus(windowActivity)
      sessionDidChange()
      return
    }

    trees[tabID] = newTree
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusHistoryByTab[tabID]?.current == surfaceID {
      if let nextSurface {
        focusSurface(nextSurface, in: tabID)
      } else {
        focusHistoryByTab.removeValue(forKey: tabID)
      }
    }
    syncFocus(windowActivity)
    sessionDidChange()
  }

  func requestCloseSurfaceAfterProcessExit(
    _ surfaceID: UUID,
    source: TerminalSurfaceCloseSource
  ) {
    guard zmxSessionsEnabled, zmxClient.isBundled() else {
      requestCloseSurface(
        surfaceID,
        needsConfirmation: false,
        source: source
      )
      return
    }

    let zmxClient = zmxClient
    let sessionID = ZmxSessionID.make(surfaceID: surfaceID)
    Task { @MainActor [weak self, zmxClient] in
      let sessionIDs = await zmxClient.listSessions()
      guard let self else { return }
      self.finishCloseSurfaceAfterProcessExit(
        surfaceID,
        sessionIDs: sessionIDs,
        sessionID: sessionID,
        source: source,
        didRetry: false
      )
    }
  }

  func finishCloseSurfaceAfterProcessExit(
    _ surfaceID: UUID,
    sessionIDs: [String]?,
    sessionID: String,
    source: TerminalSurfaceCloseSource,
    didRetry: Bool
  ) {
    guard let sessionIDs else {
      guard !didRetry else {
        requestCloseSurface(
          surfaceID,
          needsConfirmation: false,
          source: source
        )
        return
      }
      let zmxClient = zmxClient
      Task { @MainActor [weak self, zmxClient] in
        try? await Task.sleep(for: .milliseconds(150))
        let retrySessionIDs = await zmxClient.listSessions()
        guard let self else { return }
        self.finishCloseSurfaceAfterProcessExit(
          surfaceID,
          sessionIDs: retrySessionIDs,
          sessionID: sessionID,
          source: source,
          didRetry: true
        )
      }
      return
    }
    guard sessionIDs.contains(sessionID), reattachZmxSurface(surfaceID, source: source) else {
      requestCloseSurface(
        surfaceID,
        needsConfirmation: false,
        source: source
      )
      return
    }
  }

  private func cleanupSurface(_ surface: GhosttySurfaceView) {
    onSurfaceRemoved(surface.id)
    agentPanelController?.surfaceRemoved(surface.id)
    notificationStore.removeSurface(surface.id)
    paneAgentMetadataBySurfaceID.removeValue(forKey: surface.id)
    agentStateStore.clearSessions(for: surface.id)
    surface.closeSurface()
    surfaces.removeValue(forKey: surface.id)
  }

  func removeTree(
    for tabID: TerminalTabID,
    terminateSessions: Bool = true,
    source: TerminalTreeRemovalSource
  ) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    let surfaceIDs = tree.leaves().map(\.id)
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.tree.remove",
      fields: [
        "source=\(source.rawValue)",
        "tabID=\(SupatermLog.uuid(tabID.rawValue))",
        "isPinned=\(isPinned(tabID))",
        "terminateSessions=\(terminateSessions)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
    if terminateSessions {
      killZmxSessions(for: surfaceIDs)
    }
    for surface in tree.leaves() {
      cleanupSurface(surface)
    }
    focusHistoryByTab.removeValue(forKey: tabID)
    previousSelectedTabIDBySpace = previousSelectedTabIDBySpace.filter { $0.value != tabID }
  }

  func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains(where: \.needsCloseConfirmation)
  }

  func shouldCloseWindow<S: Sequence>(afterClosing tabIDs: S) -> Bool where S.Element == TerminalTabID {
    let requestedTabIDs = Set(tabIDs)
    let existingTabIDs = Set(spaces.flatMap { spaceManager.tabs(in: $0.id).map(\.id) })
    return !requestedTabIDs.isDisjoint(with: existingTabIDs)
      && existingTabIDs.subtracting(requestedTabIDs).isEmpty
  }

  func shouldCloseWindow(afterClosingSurface surfaceID: UUID) -> Bool {
    guard
      let tabID = tabID(containing: surfaceID),
      let tree = trees[tabID],
      let node = tree.find(id: surfaceID)
    else {
      return false
    }
    guard tree.removing(node).isEmpty else { return false }
    return shouldCloseWindow(afterClosing: [tabID])
  }

  func windowNeedsCloseConfirmation() -> Bool {
    Self.anyTabNeedsCloseConfirmation(
      trees.keys,
      tabNeedsCloseConfirmation: tabNeedsCloseConfirmation
    )
  }

  static func anyTabNeedsCloseConfirmation<TabIDs: Sequence>(
    _ tabIDs: TabIDs,
    tabNeedsCloseConfirmation: (TerminalTabID) -> Bool
  ) -> Bool where TabIDs.Element == TerminalTabID {
    tabIDs.contains(where: tabNeedsCloseConfirmation)
  }

  func surfaceNeedsCloseConfirmation(_ surfaceID: UUID) -> Bool {
    surfaces[surfaceID]?.needsCloseConfirmation ?? false
  }

  func resolvedCloseRequest(
    for target: TerminalCloseTarget,
    needsConfirmationOverride: Bool? = nil
  ) -> ResolvedCloseRequest? {
    switch target {
    case .surface(let surfaceID):
      guard surfaces[surfaceID] != nil else { return nil }
      if shouldCloseWindow(afterClosingSurface: surfaceID) {
        return .window(
          needsConfirmation: needsConfirmationOverride ?? windowNeedsCloseConfirmation()
        )
      }
      return .request(
        TerminalCloseRequest(
          target: .surface(surfaceID),
          needsConfirmation: needsConfirmationOverride ?? surfaceNeedsCloseConfirmation(surfaceID)
        )
      )

    case .tab(let tabID):
      guard trees[tabID] != nil else { return nil }
      if shouldCloseWindow(afterClosing: [tabID]) {
        return .window(needsConfirmation: needsConfirmationOverride ?? windowNeedsCloseConfirmation())
      }
      return .request(
        TerminalCloseRequest(
          target: .tab(tabID),
          needsConfirmation: needsConfirmationOverride ?? tabNeedsCloseConfirmation(tabID)
        )
      )

    case .tabs(let tabIDs):
      let existingTabIDs = tabIDs.filter { spaceManager.tab(for: $0) != nil }
      guard !existingTabIDs.isEmpty else { return nil }
      if shouldCloseWindow(afterClosing: existingTabIDs) {
        return .window(needsConfirmation: needsConfirmationOverride ?? windowNeedsCloseConfirmation())
      }
      let tabIDsWithTrees = existingTabIDs.filter { trees[$0] != nil }
      return .request(
        TerminalCloseRequest(
          target: .tabs(existingTabIDs),
          needsConfirmation: needsConfirmationOverride
            ?? Self.anyTabNeedsCloseConfirmation(
              tabIDsWithTrees,
              tabNeedsCloseConfirmation: tabNeedsCloseConfirmation
            )
        )
      )

    case .group(let groupID):
      guard
        let space = spaceManager.space(for: groupID),
        let manager = spaceManager.tabManager(for: space.id)
      else {
        return nil
      }
      let tabIDs = manager.tabIDs(in: groupID)
      guard !tabIDs.isEmpty else { return nil }
      if shouldCloseWindow(afterClosing: tabIDs) {
        return .window(needsConfirmation: needsConfirmationOverride ?? windowNeedsCloseConfirmation())
      }
      return .request(
        TerminalCloseRequest(
          target: .group(groupID),
          needsConfirmation: needsConfirmationOverride
            ?? Self.anyTabNeedsCloseConfirmation(
              tabIDs,
              tabNeedsCloseConfirmation: tabNeedsCloseConfirmation
            )
        )
      )
    }
  }

  func tabID(containing surfaceID: UUID) -> TerminalTabID? {
    for (tabID, tree) in trees where tree.find(id: surfaceID) != nil {
      return tabID
    }
    return nil
  }

  func logClosePerformDropped(
    surfaceID: UUID,
    tabID: TerminalTabID? = nil,
    source: TerminalSurfaceCloseSource,
    reason: String
  ) {
    var fields = [
      "source=\(source.rawValue)",
      "surfaceID=\(SupatermLog.uuid(surfaceID))",
    ]
    if let tabID {
      fields.append("tabID=\(SupatermLog.uuid(tabID.rawValue))")
    }
    fields.append("reason=\(reason)")
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.perform.dropped",
      fields: fields
    )
  }

  func logClosePerform(_ context: TerminalClosePerformLogContext) {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.perform",
      fields: [
        "source=\(context.source.rawValue)",
        "surfaceID=\(SupatermLog.uuid(context.surfaceID))",
        "tabID=\(SupatermLog.uuid(context.tabID.rawValue))",
        "spaceID=\(SupatermLog.uuid(context.spaceID?.rawValue))",
        "wasPinned=\(context.wasPinned)",
        "leafCount=\(context.leafCount)",
        "newTreeEmpty=\(context.newTreeEmpty)",
        "focusedSurfaceID=\(SupatermLog.uuid(context.focusedSurfaceID))",
        "nextSurfaceID=\(SupatermLog.uuid(context.nextSurfaceID))",
      ]
    )
  }

  func logCloseKillSurface(
    surfaceID: UUID,
    tabID: TerminalTabID,
    source: TerminalSurfaceCloseSource
  ) {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.killSurface",
      fields: [
        "source=\(source.rawValue)",
        "surfaceID=\(SupatermLog.uuid(surfaceID))",
        "tabID=\(SupatermLog.uuid(tabID.rawValue))",
      ]
    )
  }

  func logCloseRequest(
    surfaceID: UUID,
    needsConfirmationOverride: Bool?,
    resolvedCloseRequest: ResolvedCloseRequest,
    source: TerminalSurfaceCloseSource
  ) {
    let tabID = tabID(containing: surfaceID)
    let resolvedTarget: String
    let resolvedNeedsConfirmation: Bool
    switch resolvedCloseRequest {
    case .request(let request):
      resolvedTarget = "\(request.target)"
      resolvedNeedsConfirmation = request.needsConfirmation
    case .window(let needsConfirmation):
      resolvedTarget = "window"
      resolvedNeedsConfirmation = needsConfirmation
    }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.request",
      fields: [
        "source=\(source.rawValue)",
        "surfaceID=\(SupatermLog.uuid(surfaceID))",
        "tabID=\(SupatermLog.uuid(tabID?.rawValue))",
        "selectedTabID=\(SupatermLog.uuid(selectedTabID?.rawValue))",
        "focusedSurfaceID=\(SupatermLog.uuid(tabID.flatMap { focusHistoryByTab[$0]?.current }))",
        "isPinned=\(tabID.map(isPinned) ?? false)",
        "needsConfirmationOverride=\(needsConfirmationOverride.map { "\($0)" } ?? "nil")",
        "resolvedTarget=\(resolvedTarget)",
        "resolvedNeedsConfirmation=\(resolvedNeedsConfirmation)",
      ]
    )
  }

  func removeTrees(
    for tabIDs: [TerminalTabID],
    terminateSessions: Bool = true,
    source: TerminalTreeRemovalSource
  ) {
    for tabID in tabIDs {
      removeTree(for: tabID, terminateSessions: terminateSessions, source: source)
    }
  }
}
