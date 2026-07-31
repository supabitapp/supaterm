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

  func warmSpace(_ spaceID: TerminalSpaceID) {
    applyObservedSpaceCatalog(spaceCatalog)
    guard managesTerminalSurfaces, spaceManager.space(for: spaceID) != nil else { return }
    guard spaceManager.tabs(in: spaceID).isEmpty else { return }
    createTab(in: spaceID, focusing: false, synchronizesFocus: false)
  }

  func paneCount(inSpace spaceID: TerminalSpaceID) -> Int {
    spaceManager.tabs(in: spaceID).reduce(0) { count, tab in
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
    settleDisplayedSpace()
  }

  func replaceSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = spaceCatalog }
  }

  private func settleDisplayedSpace() {
    withBatchedSessionChange {
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
