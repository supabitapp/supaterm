import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermSupport
import SupatermTerminalModels
import SwiftUI

extension TerminalHostState {
  @discardableResult
  func reattachZmxSurface(
    _ surfaceID: UUID,
    source: TerminalSurfaceCloseSource
  ) -> Bool {
    guard let tabID = tabID(containing: surfaceID), var tree = trees[tabID] else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.zmxReattach.dropped",
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
        "terminal.close.zmxReattach.dropped",
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
      surfaceID: surfaceID
    )
    replacementSurface.bridge.state.titleOverride = titleOverride

    do {
      tree = try tree.replacing(node: node, with: .leaf(view: replacementSurface))
    } catch {
      surfaces.removeValue(forKey: surfaceID)
      replacementSurface.closeSurface()
      configureBridgeCloseCallbacks(for: previousSurface)
      surfaces[surfaceID] = previousSurface
      SupatermLog.error(
        SupatermLog.terminal,
        "terminal.close.zmxReattach.failed",
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
      "terminal.close.zmxReattach.finished",
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

  public func liveSurfaceIDs() -> [UUID] {
    Array(surfaces.keys).sorted { $0.uuidString < $1.uuidString }
  }

  func killZmxSession(for surfaceID: UUID) {
    killZmxSessions(for: [surfaceID])
  }

  func killZmxSessions(for surfaceIDs: [UUID]) {
    let surfaceIDs = Array(Set(surfaceIDs))
    guard !surfaceIDs.isEmpty else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.kill.skipped", fields: ["reason=empty"])
      return
    }
    guard zmxSessionsEnabled else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.kill.skipped", fields: ["reason=disabled"])
      return
    }
    guard zmxClient.isBundled() else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.kill.skipped", fields: ["reason=unbundled"])
      return
    }
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.kill.enqueue",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
    let zmxClient = zmxClient
    Task.detached(priority: .utility) {
      await withTaskGroup(of: Void.self) { group in
        for surfaceID in surfaceIDs {
          group.addTask {
            await zmxClient.killSession(surfaceID)
          }
        }
      }
    }
  }

  func killZmxSessionsAndWait(for surfaceIDs: [UUID]) async {
    let surfaceIDs = Array(Set(surfaceIDs))
    guard !surfaceIDs.isEmpty else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.killAndWait.skipped", fields: ["reason=empty"])
      return
    }
    guard zmxSessionsEnabled else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.killAndWait.skipped", fields: ["reason=disabled"])
      return
    }
    guard zmxClient.isBundled() else {
      SupatermLog.debug(SupatermLog.zmx, "zmx.killAndWait.skipped", fields: ["reason=unbundled"])
      return
    }
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.killAndWait.start",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
    let zmxClient = zmxClient
    await withTaskGroup(of: Void.self) { group in
      for surfaceID in surfaceIDs {
        group.addTask {
          await zmxClient.killSession(surfaceID)
        }
      }
    }
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.killAndWait.finished",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(Self.logSurfaceIDs(surfaceIDs))",
      ]
    )
  }

  public func terminateLiveTerminalSessions() {
    killZmxSessions(for: liveSurfaceIDs())
  }

  public func terminateLiveTerminalSessionsAndWait() async {
    await killZmxSessionsAndWait(for: liveSurfaceIDs())
  }
}
