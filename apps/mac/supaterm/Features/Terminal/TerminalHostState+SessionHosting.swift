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
    let workingDirectory = existingWorkingDirectoryURL(for: workingDirectoryPath(for: previousSurface))
    let titleOverride = previousSurface.bridge.state.titleOverride
    previousSurface.bridge.onChildExited = nil
    previousSurface.bridge.onCloseRequest = nil

    let replacementSurface = createSurface(
      tabID: tabID,
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
    guard sessionPersistenceEnabled else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.kill.skipped", fields: ["reason=disabled"])
      return
    }
    guard sessionHostClient.canManageSessions() else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.kill.skipped", fields: ["reason=cannotManageSessions"])
      return
    }
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.kill.enqueue",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
    let sessionHostClient = sessionHostClient
    Task.detached(priority: .utility) {
      await withTaskGroup(of: Void.self) { group in
        for surfaceID in surfaceIDs {
          group.addTask {
            await sessionHostClient.killSession(surfaceID)
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
    guard sessionPersistenceEnabled else {
      SupatermLog.debug(SupatermLog.sessionHost, "sessionHost.killAndWait.skipped", fields: ["reason=disabled"])
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
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.killAndWait.start",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
    let sessionHostClient = sessionHostClient
    await withTaskGroup(of: Void.self) { group in
      for surfaceID in surfaceIDs {
        group.addTask {
          await sessionHostClient.killSession(surfaceID)
        }
      }
    }
    SupatermLog.debug(
      SupatermLog.sessionHost,
      "sessionHost.killAndWait.finished",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
  }

  func terminateTerminalSessions() {
    killHostedSessions(for: sessionSurfaceIDs())
  }

  func terminateTerminalSessionsAndWait() async {
    await killHostedSessionsAndWait(for: sessionSurfaceIDs())
  }
}
