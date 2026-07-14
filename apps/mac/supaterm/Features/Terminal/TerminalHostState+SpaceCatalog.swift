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
    directoryURL: URL,
    in spaceID: TerminalSpaceID? = nil,
    focusing: Bool = true
  ) throws -> TerminalProjectID {
    try createProjects(
      directoryURLs: [directoryURL],
      in: spaceID,
      focusing: focusing
    )[0]
  }

  @discardableResult
  func createProjects(
    directoryURLs: [URL],
    in spaceID: TerminalSpaceID? = nil,
    focusing: Bool = true
  ) throws -> [TerminalProjectID] {
    guard !directoryURLs.isEmpty else { return [] }
    guard let spaceID = spaceID ?? selectedSpaceID else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }

    var knownDirectoryURLs = Set(
      spaceCatalog.spaces[spaceIndex].projects.compactMap {
        TerminalProjectItem.canonicalDirectoryURL($0.directoryURL)
      }
    )
    let canonicalDirectoryURLs = try directoryURLs.map { directoryURL in
      guard directoryURL.isFileURL else {
        throw TerminalControlError.invalidProjectDirectory
      }
      guard let directoryURL = TerminalProjectItem.reachableDirectoryURL(directoryURL) else {
        throw TerminalControlError.projectDirectoryUnavailable
      }
      guard knownDirectoryURLs.insert(directoryURL).inserted else {
        throw TerminalControlError.projectAlreadyExists
      }
      return directoryURL
    }
    let projects = canonicalDirectoryURLs.map { TerminalProjectItem(directoryURL: $0) }
    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[spaceIndex].projects.append(contentsOf: projects)
    if focusing {
      updatedSpaceCatalog.defaultSelectedSpaceID = spaceID
    }
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    if focusing {
      _ = applySelectedSpace(spaceID)
    }
    let createdTabIDs = projects.compactMap { project in
      createTab(
        in: spaceID,
        projectID: project.id,
        focusing: false,
        workingDirectory: project.directoryURL,
        sessionChangesEnabled: false,
        synchronizesFocus: false
      )
    }
    if focusing {
      if let selectedTabID = createdTabIDs.last {
        applySelectedTab(selectedTabID, in: spaceID)
      }
      finalizeSpaceSelectionChange()
    } else {
      syncFocus(windowActivity)
    }
    sessionDidChange()
    return projects.map(\.id)
  }

  func deleteProject(_ projectID: TerminalProjectID) {
    guard let spaceID = spaceManager.space(for: projectID)?.id else { return }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }

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
    projectDirectoryMonitor.update(
      urls: resolvedSpaceCatalog.spaces.flatMap { $0.projects.map(\.directoryURL) }
    )
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
    projectDirectoryMonitor.update(
      urls: resolvedSpaceCatalog.spaces.flatMap { $0.projects.map(\.directoryURL) }
    )
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
