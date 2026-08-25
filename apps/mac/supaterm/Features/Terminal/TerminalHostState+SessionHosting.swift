import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermSupport
import SwiftUI

extension TerminalHostState {
  @discardableResult
  func reattachHostedSurface(
    _ surfaceID: UUID,
    source: TerminalSurfaceCloseSource
  ) -> Bool {
    guard let tabID = tabID(containing: surfaceID), var tree = trees[tabID] else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.sessionHostReattach.dropped",
        fields: [
          "source=\(source.rawValue)",
          "surfaceID=\(SupatermLog.uuid(surfaceID))",
          "reason=missingTree",
        ]
      )
      return false
    }
    guard let node = tree.find(id: surfaceID), let previousSurface = surfaces[surfaceID] else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.sessionHostReattach.dropped",
        fields: [
          "source=\(source.rawValue)",
          "surfaceID=\(SupatermLog.uuid(surfaceID))",
          "tabID=\(SupatermLog.uuid(tabID.rawValue))",
          "reason=missingSurface",
        ]
      )
      return false
    }

    let context = reattachSurfaceContext(for: tabID, tree: tree)
    let workingDirectory = restoredWorkingDirectoryURL(
      for: workingDirectoryPath(for: previousSurface),
      hostID: previousSurface.hostID
    )
    let titleOverride = previousSurface.bridge.state.titleOverride
    previousSurface.bridge.onChildExited = nil
    previousSurface.bridge.onCloseRequest = nil

    let replacementSurface = createSurface(
      tabID: tabID,
      hostID: previousSurface.hostID,
      startupCommand: nil,
      inheritingFromSurfaceID: nil,
      workingDirectory: workingDirectory,
      context: context,
      surfaceID: surfaceID,
      restoreMode: previousSurface.restoreMode,
      sessionHostAttachMode: .existing
    )
    replacementSurface.bridge.state.titleOverride = titleOverride

    do {
      tree = try tree.replacing(node: node, with: .leaf(view: replacementSurface))
    } catch {
      surfaces.removeValue(forKey: surfaceID)
      replacementSurface.closeSurface()
      configureBridgeCloseCallbacks(for: previousSurface)
      surfaces[surfaceID] = previousSurface
      agentDetectionController?.surfaceDidAttach(surfaceID)
      SupatermLog.error(
        SupatermLog.terminal,
        "terminal.close.sessionHostReattach.failed",
        fields: [
          "source=\(source.rawValue)",
          "surfaceID=\(SupatermLog.uuid(surfaceID))",
          "tabID=\(SupatermLog.uuid(tabID.rawValue))",
          "error=\(String(describing: error))",
        ]
      )
      return false
    }

    previousSurface.closeSurface()
    trees[tabID] = tree
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusHistoryByTab[tabID]?.current == surfaceID {
      focusSurface(replacementSurface, in: tabID)
    }
    syncFocus(windowActivity)
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.sessionHostReattach.finished",
      fields: [
        "source=\(source.rawValue)",
        "surfaceID=\(SupatermLog.uuid(surfaceID))",
        "tabID=\(SupatermLog.uuid(tabID.rawValue))",
        "context=\(Self.surfaceContextLabel(context))",
      ]
    )
    return true
  }

  func reattachSurfaceContext(
    for tabID: TerminalTabID,
    tree: SplitTree<GhosttySurfaceView>
  ) -> ghostty_surface_context_e {
    guard !tree.isSplit else { return GHOSTTY_SURFACE_CONTEXT_SPLIT }
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tabs(in: spaceID).first?.id == tabID
    else {
      return GHOSTTY_SURFACE_CONTEXT_TAB
    }
    return GHOSTTY_SURFACE_CONTEXT_WINDOW
  }

  func liveSurfaceIDs() -> [UUID] {
    Array(surfaces.keys).sorted { $0.uuidString < $1.uuidString }
  }

  func sessionSurfaceIDs() -> [UUID] {
    Set(surfaces.keys)
      .union(spaceManager.pendingSurfaceIDs)
      .sorted { $0.uuidString < $1.uuidString }
  }

  func killHostedSession(for surfaceID: UUID) {
    killHostedSessions(for: [surfaceID])
  }

  func killHostedSessions(for surfaceIDs: [UUID]) {
    let surfaceIDs = Array(Set(surfaceIDs))
    guard !surfaceIDs.isEmpty else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.kill.skipped", fields: ["reason=empty"])
      return
    }
    guard sessionHostClient.canManageSessions() else {
      return
    }
    let sessions = hostedSessions(for: surfaceIDs).filter {
      sessionPersistenceEnabled || $0.remoteHost != nil
    }
    guard !sessions.isEmpty else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.kill.skipped", fields: ["reason=disabled"])
      return
    }
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.kill.enqueue",
      fields: [
        "count=\(sessions.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(sessions.map(\.surfaceID)))",
      ]
    )
    let sessionHostClient = sessionHostClient
    Task.detached(priority: .utility) {
      await withTaskGroup(of: Void.self) { group in
        for (surfaceID, remoteHost) in sessions {
          group.addTask {
            await sessionHostClient.killSession(surfaceID, remoteHost)
          }
        }
      }
    }
  }

  func killHostedSessionsAndWait(for surfaceIDs: [UUID]) async {
    let surfaceIDs = Array(Set(surfaceIDs))
    guard !surfaceIDs.isEmpty else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.killAndWait.skipped", fields: ["reason=empty"])
      return
    }
    guard sessionHostClient.canManageSessions() else {
      SupatermLog.debug(
        SupatermLog.sessionHost,
        "sessionHost.killAndWait.skipped",
        fields: ["reason=cannotManageSessions"]
      )
      return
    }
    let sessions = hostedSessions(for: surfaceIDs).filter {
      sessionPersistenceEnabled || $0.remoteHost != nil
    }
    guard !sessions.isEmpty else {
      SupatermLog.debug(
        SupatermLog.sessionHost,
        "sessionHost.killAndWait.skipped",
        fields: ["reason=disabled"]
      )
      return
    }
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.killAndWait.start",
      fields: [
        "count=\(sessions.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(sessions.map(\.surfaceID)))",
      ]
    )
    let sessionHostClient = sessionHostClient
    await withTaskGroup(of: Void.self) { group in
      for (surfaceID, remoteHost) in sessions {
        group.addTask {
          await sessionHostClient.killSession(surfaceID, remoteHost)
        }
      }
    }
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.killAndWait.finished",
      fields: [
        "count=\(sessions.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(sessions.map(\.surfaceID)))",
      ]
    )
  }

  func terminateTerminalSessions() {
    killHostedSessions(for: sessionSurfaceIDs())
  }

  func terminateTerminalSessionsAndWait() async {
    await killHostedSessionsAndWait(for: sessionSurfaceIDs())
  }

  private func hostedSessions(
    for surfaceIDs: [UUID]
  ) -> [(surfaceID: UUID, remoteHost: SupatermRemoteHost?)] {
    surfaceIDs.compactMap { surfaceID in
      guard let hostID = surfaces[surfaceID]?.hostID ?? pendingHostID(for: surfaceID) else {
        return (surfaceID, nil)
      }
      guard let remoteHost = supatermSettings.remoteHosts.first(where: { $0.id == hostID }) else {
        SupatermLog.error(
          SupatermLog.sessionHost,
          "sessionHost.kill.missingHost",
          fields: [
            "hostID=\(hostID)",
            "surfaceID=\(surfaceID.uuidString.lowercased())",
          ]
        )
        return nil
      }
      return (surfaceID, remoteHost)
    }
  }

  private func pendingHostID(for surfaceID: UUID) -> String? {
    for instance in spaceManager.instances {
      for tab in instance.pendingSession?.tabs ?? [] {
        if let hostID = tab.root.leaf(id: surfaceID)?.hostID {
          return hostID
        }
      }
    }
    return nil
  }
}
