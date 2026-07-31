import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermSupport
import SwiftUI

extension TerminalHostState {
  func isSpaceNameAvailable(
    _ proposedName: String,
    excluding excludedSpaceID: TerminalSpaceID? = nil
  ) -> Bool {
    guard let name = Self.trimmedNonEmpty(proposedName) else { return false }
    return !spaces.contains {
      $0.id != excludedSpaceID && $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame
    }
  }

  @discardableResult
  func displaySpace(_ spaceID: TerminalSpaceID) -> Bool {
    applyObservedSpaceCatalog(spaceCatalog)
    guard spaceManager.display(spaceID) else { return false }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.space.display",
      fields: [
        "spaceID=\(SupatermLog.uuid(spaceID.rawValue))",
        "tabs=\(tabs.count)",
      ]
    )
    settleDisplayedSpace()
    return true
  }

  func switchSpace(to spaceID: TerminalSpaceID) -> Bool {
    let origin = displayedSpaceID
    guard displaySpace(spaceID) else { return false }
    let from = spaces.firstIndex { $0.id == origin } ?? displayedSpaceIndex
    spacePager?.slide?(from, displayedSpaceIndex)
    return true
  }

  func selectSpace(_ spaceID: TerminalSpaceID) {
    onSpaceAction(.select(spaceID))
  }

  func warmSpace(_ spaceID: TerminalSpaceID) {
    applyObservedSpaceCatalog(spaceCatalog)
    guard managesTerminalSurfaces, spaceManager.space(for: spaceID) != nil else { return }
    warmInstance(for: spaceID)
    guard spaceManager.tabs(in: spaceID).isEmpty else { return }
    createTab(in: spaceID, focusing: false, synchronizesFocus: false)
  }

  func space(warming spaceID: TerminalSpaceID) -> TerminalSpaceItem? {
    guard let space = spaceManager.space(for: spaceID) else { return nil }
    warmInstance(for: spaceID)
    return space
  }

  func warmInstance(for spaceID: TerminalSpaceID) {
    guard managesTerminalSurfaces else { return }
    guard
      let instance = spaceManager.instance(for: spaceID),
      let session = instance.pendingSession
    else {
      return
    }
    instance.pendingSession = nil
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.space.warm",
      fields: [
        "spaceID=\(SupatermLog.uuid(spaceID.rawValue))",
        "surfaces=\(session.surfaceIDs.count)",
      ]
    )
    restoreSpaceSession(session)
  }

  func paneCount(inSpace spaceID: TerminalSpaceID) -> Int {
    guard let instance = spaceManager.instance(for: spaceID) else { return 0 }
    if let pendingSession = instance.pendingSession {
      return pendingSession.surfaceIDs.count
    }
    return instance.tabs.reduce(0) { count, tab in
      count + (trees[tab.id]?.leaves().count ?? 0)
    }
  }

  func observeSpaceCatalog() {
    spaceCatalogObservationTask?.cancel()
    spaceCatalogObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.spaceCatalog ?? .default
      }
      for await spaceCatalog in observations {
        guard let self else { return }
        self.applyObservedSpaceCatalog(spaceCatalog)
      }
    }
  }

  func applyObservedSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard resolvedSpaceCatalog != spaceManager.catalog else { return }
    let discardedInstances = spaceManager.applyCatalog(resolvedSpaceCatalog)
    guard !discardedInstances.isEmpty else { return }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.space.discard",
      fields: [
        "spaces=\(discardedInstances.count)",
        "displayedSpaceID=\(SupatermLog.uuid(displayedSpaceID.rawValue))",
      ]
    )
    removeTrees(
      for: discardedInstances.flatMap { $0.tabs.map(\.id) },
      source: .deleteSpace
    )
    killZmxSessions(
      for: discardedInstances.flatMap { $0.pendingSession?.surfaceIDs ?? [] }
    )
    settleDisplayedSpace()
  }

  func replaceSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = spaceCatalog }
  }

  private func settleDisplayedSpace() {
    withBatchedSessionChange {
      warmInstance(for: displayedSpaceID)
      if managesTerminalSurfaces {
        ensureInitialTab(focusing: true)
      }
      if let selectedTabID {
        focusSurfaceIfNeeded(in: selectedTabID)
      }
      syncFocus(windowActivity)
    }
  }
}
