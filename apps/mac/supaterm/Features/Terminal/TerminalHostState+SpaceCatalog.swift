import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  @discardableResult
  func createSpace(named name: String, focus: Bool = true) throws -> TerminalSpaceID {
    guard let normalizedName = Self.trimmedNonEmpty(name) else {
      throw TerminalControlError.invalidSpaceName
    }
    guard spaceManager.isNameAvailable(normalizedName) else {
      throw TerminalControlError.spaceNameUnavailable
    }

    let space = PersistedTerminalSpace(
      name: normalizedName
    )
    let previousSpaceCatalog = spaceCatalog
    var updatedSpaceCatalog = previousSpaceCatalog
    if focus {
      updatedSpaceCatalog.defaultSelectedSpaceID = space.id
    }
    updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: updatedSpaceCatalog.defaultSelectedSpaceID,
      spaces: updatedSpaceCatalog.spaces + [space]
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    guard
      createTab(
        in: space.id,
        focusing: false,
        sessionChangesEnabled: false,
        synchronizesFocus: false
      ) != nil
    else {
      _ = writeSpaceCatalog(previousSpaceCatalog)
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: spaces.count + 1)
    }
    if focus {
      guard applySelectedSpace(space.id) else {
        _ = writeSpaceCatalog(previousSpaceCatalog)
        throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: spaces.count)
      }
      finalizeSpaceSelectionChange()
    }
    sessionDidChange()
    return space.id
  }

  func renameSpace(_ spaceID: TerminalSpaceID, to name: String) throws {
    guard let normalizedName = Self.trimmedNonEmpty(name) else {
      throw TerminalControlError.invalidSpaceName
    }
    guard spaceManager.isNameAvailable(normalizedName, excluding: spaceID) else {
      throw TerminalControlError.spaceNameUnavailable
    }
    guard let index = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[index].name = normalizedName
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  func deleteSpace(_ spaceID: TerminalSpaceID) {
    let remainingSpaces = spaceCatalog.spaces.filter { $0.id != spaceID }
    guard !remainingSpaces.isEmpty else { return }
    guard remainingSpaces.count != spaceCatalog.spaces.count else { return }
    if previousSelectedSpaceID == spaceID {
      previousSelectedSpaceID = nil
    }

    let nextSelectedSpaceID = nextSelectedSpaceID(afterDeleting: spaceID)
    let updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: nextSelectedSpaceID,
      spaces: remainingSpaces
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  func isSpaceNameAvailable(
    _ proposedName: String,
    excluding excludedSpaceID: TerminalSpaceID? = nil
  ) -> Bool {
    spaceManager.isNameAvailable(proposedName, excluding: excludedSpaceID)
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
    guard resolvedSpaceCatalog != lastAppliedSpaceCatalog else { return }

    let previousSelectedSpaceID = selectedSpaceID
    lastAppliedSpaceCatalog = resolvedSpaceCatalog
    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs, source: .spaceCatalogObserved)
    let spaceIDs = Set(spaces.map(\.id))
    collapsedTabGroupIDsBySpace = collapsedTabGroupIDsBySpace.filter { spaceIDs.contains($0.key) }

    if previousSelectedSpaceID != selectedSpaceID {
      finalizeSpaceSelectionChange()
      sessionDidChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
      sessionDidChange()
    }
  }

  @discardableResult
  func writeSpaceCatalog(
    _ spaceCatalog: TerminalSpaceCatalog
  ) -> TerminalSpaceManager.SpaceCatalogDiff {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    replaceSpaceCatalog(resolvedSpaceCatalog)
    lastAppliedSpaceCatalog = resolvedSpaceCatalog

    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs, source: .spaceCatalogWrite)
    let spaceIDs = Set(spaces.map(\.id))
    collapsedTabGroupIDsBySpace = collapsedTabGroupIDsBySpace.filter { spaceIDs.contains($0.key) }
    return diff
  }

  func persistDefaultSelectedSpaceID(_ spaceID: TerminalSpaceID) {
    guard spaceCatalog.defaultSelectedSpaceID != spaceID else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = spaceID
    replaceSpaceCatalog(updatedSpaceCatalog)
    lastAppliedSpaceCatalog = updatedSpaceCatalog
  }

  func replaceSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = spaceCatalog }
  }
}
