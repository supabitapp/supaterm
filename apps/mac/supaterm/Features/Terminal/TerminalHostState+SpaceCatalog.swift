import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  @discardableResult
  func createSpace(named name: String) throws -> TerminalSpaceID {
    guard let normalizedName = Self.trimmedNonEmpty(name) else {
      throw TerminalControlError.invalidSpaceName
    }
    guard spaceManager.isNameAvailable(normalizedName) else {
      throw TerminalControlError.spaceNameUnavailable
    }

    let space = PersistedTerminalSpace(
      name: normalizedName
    )
    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = space.id
    updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: updatedSpaceCatalog.defaultSelectedSpaceID,
      spaces: updatedSpaceCatalog.spaces + [space]
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    guard applySelectedSpace(space.id) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: spaces.count + 1)
    }
    _ = createTab(in: space.id, projectID: space.projects[0].id, focusing: true)
    finalizeSpaceSelectionChange()
    sessionDidChange()
    return space.id
  }

  func renameSpace(_ spaceID: TerminalSpaceID, to name: String) {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedName.isEmpty else { return }
    guard spaceManager.isNameAvailable(normalizedName, excluding: spaceID) else { return }
    guard let index = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }

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

  @discardableResult
  func createProject(
    named name: String,
    in spaceID: TerminalSpaceID? = nil,
    focusing: Bool = true
  ) throws -> TerminalProjectID {
    guard let normalizedName = Self.trimmedNonEmpty(name) else {
      throw TerminalControlError.invalidProjectName
    }
    guard let spaceID = spaceID ?? selectedSpaceID else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    guard spaceManager.isProjectNameAvailable(normalizedName, in: spaceID) else {
      throw TerminalControlError.projectNameUnavailable
    }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }

    let project = TerminalProjectItem(name: normalizedName)
    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[spaceIndex].projects.append(project)
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    _ = createTab(in: spaceID, projectID: project.id, focusing: focusing)
    return project.id
  }

  func renameProject(_ projectID: TerminalProjectID, to name: String) {
    guard let normalizedName = Self.trimmedNonEmpty(name) else { return }
    guard let spaceID = spaceManager.space(for: projectID)?.id else { return }
    guard spaceManager.isProjectNameAvailable(normalizedName, in: spaceID, excluding: projectID) else {
      return
    }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }
    guard let projectIndex = spaceCatalog.spaces[spaceIndex].projects.firstIndex(where: { $0.id == projectID }) else {
      return
    }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[spaceIndex].projects[projectIndex].name = normalizedName
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  func deleteProject(_ projectID: TerminalProjectID) {
    guard let spaceID = spaceManager.space(for: projectID)?.id else { return }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }
    guard spaceCatalog.spaces[spaceIndex].projects.count > 1 else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[spaceIndex].projects.removeAll { $0.id == projectID }
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  func setProjectPinned(_ projectID: TerminalProjectID, isPinned: Bool) {
    guard let spaceID = spaceManager.space(for: projectID)?.id else { return }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }
    guard let projectIndex = spaceCatalog.spaces[spaceIndex].projects.firstIndex(where: { $0.id == projectID }) else {
      return
    }

    var updatedSpaceCatalog = spaceCatalog
    var project = updatedSpaceCatalog.spaces[spaceIndex].projects.remove(at: projectIndex)
    project.isPinned = isPinned
    let insertionIndex =
      isPinned
      ? updatedSpaceCatalog.spaces[spaceIndex].projects.firstIndex(where: { !$0.isPinned })
        ?? updatedSpaceCatalog.spaces[spaceIndex].projects.endIndex
      : updatedSpaceCatalog.spaces[spaceIndex].projects.endIndex
    updatedSpaceCatalog.spaces[spaceIndex].projects.insert(project, at: insertionIndex)
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  func moveProject(_ projectID: TerminalProjectID, isPinned: Bool, at destinationIndex: Int) {
    guard let spaceID = spaceManager.space(for: projectID)?.id else { return }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }
    guard let projectIndex = spaceCatalog.spaces[spaceIndex].projects.firstIndex(where: { $0.id == projectID }) else {
      return
    }

    var updatedSpaceCatalog = spaceCatalog
    var project = updatedSpaceCatalog.spaces[spaceIndex].projects.remove(at: projectIndex)
    project.isPinned = isPinned
    let laneStart = isPinned ? 0 : updatedSpaceCatalog.spaces[spaceIndex].projects.filter(\.isPinned).count
    let laneCount = updatedSpaceCatalog.spaces[spaceIndex].projects.filter { $0.isPinned == isPinned }.count
    updatedSpaceCatalog.spaces[spaceIndex].projects.insert(
      project,
      at: laneStart + max(0, min(destinationIndex, laneCount))
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  func moveTab(
    _ tabID: TerminalTabID,
    to projectID: TerminalProjectID,
    isPinned: Bool,
    at destinationIndex: Int
  ) {
    guard let spaceID = spaceManager.space(for: tabID)?.id else { return }
    guard spaceManager.space(for: projectID)?.id == spaceID else { return }
    spaceManager.projectManager(for: spaceID)?.moveTab(
      tabID,
      to: projectID,
      isPinned: isPinned,
      at: destinationIndex
    )
    syncPinnedTabMembership(in: spaceID)
    sessionDidChange()
  }

  func isProjectNameAvailable(
    _ proposedName: String,
    in spaceID: TerminalSpaceID,
    excluding excludedProjectID: TerminalProjectID? = nil
  ) -> Bool {
    spaceManager.isProjectNameAvailable(
      proposedName,
      in: spaceID,
      excluding: excludedProjectID
    )
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
    synchronizePinnedTabCatalogWithSpaces()

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
    synchronizePinnedTabCatalogWithSpaces()
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
