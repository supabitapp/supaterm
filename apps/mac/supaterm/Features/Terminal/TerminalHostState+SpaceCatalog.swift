import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  func orderedProjects(in spaceID: TerminalSpaceID) -> [TerminalProjectItem] {
    spaceManager.orderedProjects(in: spaceID)
  }

  func projectDisplayName(
    _ projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) -> String? {
    spaceCatalog.displayName(for: projectID, in: spaceID)
  }

  func tabs(
    in projectID: TerminalProjectID,
    spaceID: TerminalSpaceID
  ) -> [TerminalTabItem] {
    spaceManager.tabs(in: projectID, spaceID: spaceID)
  }

  func isProjectCollapsed(
    _ projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) -> Bool {
    collapsedProjectIDsBySpace[spaceID]?.contains(projectID) == true
  }

  func setProjectCollapsed(
    _ isCollapsed: Bool,
    projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) {
    guard orderedProjects(in: spaceID).contains(where: { $0.id == projectID }) else { return }
    if isCollapsed {
      collapsedProjectIDsBySpace[spaceID, default: []].insert(projectID)
    } else {
      collapsedProjectIDsBySpace[spaceID]?.remove(projectID)
    }
    sessionDidChange()
  }

  @discardableResult
  func createProject(
    folderPath: String,
    in spaceID: TerminalSpaceID
  ) -> TerminalProjectID? {
    let trimmedPath = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPath.isEmpty, NSString(string: trimmedPath).isAbsolutePath else { return nil }
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      return nil
    }
    let project = TerminalProjectItem(
      folderPath: URL(fileURLWithPath: trimmedPath, isDirectory: true).standardizedFileURL.path
    )
    var updatedCatalog = spaceCatalog
    updatedCatalog.spaces[spaceIndex].projects.append(project)
    _ = writeSpaceCatalog(updatedCatalog)
    sessionDidChange()
    return project.id
  }

  func deleteProject(
    _ projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) {
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      return
    }
    let projects = spaceCatalog.spaces[spaceIndex].projects
    guard let project = projects.first(where: { $0.id == projectID }), !project.isHome else {
      return
    }
    var updatedCatalog = spaceCatalog
    updatedCatalog.spaces[spaceIndex].projects.removeAll { $0.id == projectID }
    collapsedProjectIDsBySpace[spaceID]?.remove(projectID)
    _ = writeSpaceCatalog(updatedCatalog)
    sessionDidChange()
  }

  func setProjectOrder(
    _ orderedIDs: [TerminalProjectID],
    in spaceID: TerminalSpaceID
  ) {
    writeProjectOrder(orderedIDs, pinnedState: nil, in: spaceID)
  }

  func setProjectOrder(
    _ orderedIDs: [TerminalProjectID],
    settingPinned projectID: TerminalProjectID,
    to isPinned: Bool,
    in spaceID: TerminalSpaceID
  ) {
    writeProjectOrder(
      orderedIDs,
      pinnedState: (projectID, isPinned),
      in: spaceID
    )
  }

  private func writeProjectOrder(
    _ orderedIDs: [TerminalProjectID],
    pinnedState: (TerminalProjectID, Bool)?,
    in spaceID: TerminalSpaceID
  ) {
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      return
    }
    let projects = spaceCatalog.spaces[spaceIndex].projects
    var projectsByID = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
    if let (projectID, isPinned) = pinnedState {
      guard var project = projectsByID[projectID] else { return }
      project.isPinned = isPinned
      projectsByID[projectID] = project
    }
    let orderedProjects = orderedIDs.compactMap { projectsByID[$0] }
    guard orderedProjects.count == projects.count else { return }
    var updatedCatalog = spaceCatalog
    updatedCatalog.spaces[spaceIndex].projects =
      orderedProjects.filter(\.isPinned) + orderedProjects.filter { !$0.isPinned }
    _ = writeSpaceCatalog(updatedCatalog)
    sessionDidChange()
  }

  func toggleProjectPinned(
    _ projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) {
    guard let spaceIndex = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      return
    }
    var projects = spaceCatalog.spaces[spaceIndex].projects
    guard let projectIndex = projects.firstIndex(where: { $0.id == projectID }) else { return }
    var project = projects.remove(at: projectIndex)
    project.isPinned.toggle()
    let pinned = projects.filter(\.isPinned)
    let regular = projects.filter { !$0.isPinned }
    var updatedCatalog = spaceCatalog
    updatedCatalog.spaces[spaceIndex].projects =
      project.isPinned ? pinned + [project] + regular : pinned + regular + [project]
    _ = writeSpaceCatalog(updatedCatalog)
    sessionDidChange()
  }

  func setPinnedTabOrder(
    _ orderedIDs: [TerminalTabID],
    in projectID: TerminalProjectID,
    spaceID: TerminalSpaceID
  ) {
    spaceManager.tabManager(for: spaceID)?.setPinnedTabOrder(orderedIDs, in: projectID)
    sessionDidChange()
  }

  func setRegularTabOrder(
    _ orderedIDs: [TerminalTabID],
    in projectID: TerminalProjectID,
    spaceID: TerminalSpaceID
  ) {
    spaceManager.tabManager(for: spaceID)?.setRegularTabOrder(orderedIDs, in: projectID)
    sessionDidChange()
  }

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
    sanitizeCollapsedProjects()

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
    sanitizeCollapsedProjects()
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

  private func sanitizeCollapsedProjects() {
    for space in spaces {
      let validProjectIDs = Set(space.projects.map(\.id))
      collapsedProjectIDsBySpace[space.id] =
        collapsedProjectIDsBySpace[space.id]?.intersection(validProjectIDs) ?? []
    }
    let validSpaceIDs = Set(spaces.map(\.id))
    collapsedProjectIDsBySpace = collapsedProjectIDsBySpace.filter {
      validSpaceIDs.contains($0.key)
    }
  }
}
