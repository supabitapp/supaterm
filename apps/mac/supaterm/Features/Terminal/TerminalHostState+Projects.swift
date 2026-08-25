import Foundation
import Sharing
import SupaTheme

extension TerminalHostState {
  var projects: [TerminalProject] {
    projectCatalog.projects
  }

  func projectSections(in spaceID: TerminalSpaceID? = nil) -> [TerminalProjectSectionItem] {
    guard let instance = spaceManager.instance(for: spaceID ?? displayedSpaceID) else { return [] }
    return instance.tabCollection.sections(projects: projectCatalog.projects)
  }

  func unassignedSection(
    in spaceID: TerminalSpaceID? = nil
  ) -> TerminalUnassignedSectionItem? {
    guard let instance = spaceManager.instance(for: spaceID ?? displayedSpaceID) else { return nil }
    return instance.tabCollection.unassignedSection(
      orderedProjectIDs: projectCatalog.projects.map(\.id)
    )
  }

  func containsProject(_ id: TerminalProjectID) -> Bool {
    projectCatalog.projects.contains { $0.id == id }
  }

  func containsTab(_ id: UUID) -> Bool {
    let tabID = TerminalTabID(rawValue: id)
    return spaceManager.instance(for: tabID) != nil
      || spaceManager.pendingInstance(containingTab: tabID) != nil
  }

  func tabIDs(in projectID: TerminalProjectID) -> [TerminalTabID] {
    spaceManager.instances.flatMap { instance in
      if let session = instance.pendingSession {
        return session.tabs.compactMap { $0.projectID == projectID ? $0.id : nil }
      }
      return instance.tabCollection.canonicalTabs.compactMap {
        $0.projectID == projectID ? $0.id : nil
      }
    }
  }

  func suggestedProjectName(containing tabIDs: [TerminalTabID]) -> String? {
    let tabs = tabIDs.compactMap(spaceManager.tab(for:))
    let sharedRepositoryName = TerminalProjectTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: tabIDs.map(paneWorkingDirectoryPaths)
    )
    return TerminalProjectTitleSuggester.title(
      for: tabs.map {
        TerminalProjectTitleInput(title: $0.title, isTitleLocked: $0.isTitleLocked)
      },
      sharedRepositoryName: sharedRepositoryName,
      existingTitles: projectCatalog.projects.map(\.name)
    )
  }

  func suggestedProjectRoot(containing tabIDs: [TerminalTabID]) -> String? {
    suggestedProjectRoot(
      containing: tabIDs,
      workingDirectoryPaths: paneWorkingDirectoryPaths,
      repositoryRoot: TerminalProjectTitleSuggester.repositoryRoot(for:)
    )
  }

  func suggestedProjectRoot(
    containing tabIDs: [TerminalTabID],
    workingDirectoryPaths: (TerminalTabID) -> [String],
    repositoryRoot: (String) -> String?
  ) -> String? {
    TerminalProjectTitleSuggester.sharedRepositoryRoot(
      workingDirectoryPathsByTab: tabIDs.map(workingDirectoryPaths),
      repositoryRoot: repositoryRoot
    )
  }

  @discardableResult
  func createProject(
    name: String,
    rootPath: String? = nil,
    color: ThemeTint = .neutral,
    isPinned: Bool = false,
    containing tabIDs: [TerminalTabID] = []
  ) -> TerminalProjectCreationResult? {
    if let onProjectCreate {
      return onProjectCreate(name, rootPath, color, isPinned, tabIDs)
    }
    let project = TerminalProject(
      name: name,
      rootPath: rootPath,
      color: color,
      isPinned: isPinned
    )
    guard
      let catalog = try? TerminalProjectCatalog(
        projects: projectCatalog.projects + [project]
      ).validated()
    else { return nil }
    if !tabIDs.isEmpty {
      guard let instance = spaceManager.sharedInstance(containing: tabIDs) else { return nil }
      guard
        instance.tabCollection.assign(
          tabIDs,
          to: project.id,
          orderedProjectIDs: catalog.projects.map(\.id)
        )
      else { return nil }
      instance.collapsedProjectIDs.remove(project.id)
    }
    $projectCatalog.withLock { $0 = catalog }
    sessionDidChange()
    return TerminalProjectCreationResult(projectID: project.id)
  }

  @discardableResult
  func renameProject(_ id: TerminalProjectID, name: String) -> Bool {
    if let onProjectRename { return onProjectRename(id, name) }
    var catalog = projectCatalog
    guard let index = catalog.projects.firstIndex(where: { $0.id == id }) else { return false }
    catalog.projects[index].name = name
    guard let validated = try? catalog.validated() else { return false }
    $projectCatalog.withLock { $0 = validated }
    return true
  }

  @discardableResult
  func setProjectColor(_ id: TerminalProjectID, color: ThemeTint) -> Bool {
    if let onProjectColorChange { return onProjectColorChange(id, color) }
    guard let index = projectCatalog.projects.firstIndex(where: { $0.id == id }) else {
      return false
    }
    $projectCatalog.withLock { $0.projects[index].color = color }
    return true
  }

  @discardableResult
  func setProjectPinned(_ id: TerminalProjectID, isPinned: Bool) -> Bool {
    if let onProjectPinChange { return onProjectPinChange(id, isPinned) }
    var catalog = projectCatalog
    guard let project = catalog.projects.first(where: { $0.id == id }) else { return false }
    guard project.isPinned != isPinned else { return true }
    guard catalog.setPinned(id, isPinned: isPinned) else { return false }
    $projectCatalog.withLock { $0 = catalog }
    return true
  }

  @discardableResult
  func reorderProject(_ id: TerminalProjectID, toLaneIndex index: Int) -> Bool {
    if let onProjectReorder { return onProjectReorder(id, index) }
    var catalog = projectCatalog
    guard let project = catalog.projects.first(where: { $0.id == id }) else { return false }
    let lane = catalog.projects.filter { $0.isPinned == project.isPinned }
    guard lane.indices.contains(index) else { return false }
    guard lane[index].id != id else { return true }
    guard catalog.reorderProject(id, toLaneIndex: index) else { return false }
    $projectCatalog.withLock { $0 = catalog }
    return true
  }

  func isProjectCollapsed(_ id: TerminalProjectID, in spaceID: TerminalSpaceID) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID) else { return false }
    return instance.pendingSession?.collapsedProjectIDs.contains(id)
      ?? instance.collapsedProjectIDs.contains(id)
  }

  @discardableResult
  func setProjectCollapsed(
    _ id: TerminalProjectID,
    isCollapsed: Bool,
    in spaceID: TerminalSpaceID? = nil
  ) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID ?? displayedSpaceID) else { return false }
    guard containsProject(id) else { return false }
    let changed: Bool
    if var session = instance.pendingSession {
      var collapsed = Set(session.collapsedProjectIDs)
      changed = isCollapsed ? collapsed.insert(id).inserted : collapsed.remove(id) != nil
      session.collapsedProjectIDs = Array(collapsed)
      instance.pendingSession = session
    } else {
      changed =
        isCollapsed
        ? instance.collapsedProjectIDs.insert(id).inserted
        : instance.collapsedProjectIDs.remove(id) != nil
    }
    if changed { sessionDidChange() }
    return true
  }

  @discardableResult
  func setUnassignedCollapsed(_ isCollapsed: Bool, in spaceID: TerminalSpaceID? = nil) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID ?? displayedSpaceID) else { return false }
    let changed: Bool
    if var session = instance.pendingSession {
      changed = session.isUnassignedCollapsed != isCollapsed
      session.isUnassignedCollapsed = isCollapsed
      instance.pendingSession = session
    } else {
      changed = instance.isUnassignedCollapsed != isCollapsed
      instance.isUnassignedCollapsed = isCollapsed
    }
    if changed { sessionDidChange() }
    return true
  }

  func isUnassignedCollapsed(in spaceID: TerminalSpaceID) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID) else { return false }
    return instance.pendingSession?.isUnassignedCollapsed ?? instance.isUnassignedCollapsed
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    guard let firstID = request.tabIDs.first else { throw TerminalTabMoveError.emptyTabs }
    guard let instance = spaceManager.instance(for: firstID) else {
      throw TerminalTabMoveError.tabNotFound(firstID)
    }
    guard request.tabIDs.allSatisfy({ spaceManager.instance(for: $0) === instance }) else {
      throw TerminalTabMoveError.invalidDestination(request.destination)
    }
    guard request.orderedProjectIDs == projectCatalog.projects.map(\.id) else {
      throw TerminalTabMoveError.staleProjects
    }
    let previousRevision = instance.tabCollection.topologyRevision
    let revealsSection = request.tabIDs.contains { instance.tabCollection.selectedTabID == $0 }
    let result = try instance.tabCollection.move(request)
    if revealsSection {
      if let projectID = request.destination.projectID {
        instance.collapsedProjectIDs.remove(projectID)
      } else {
        instance.isUnassignedCollapsed = false
      }
    }
    if result.topologyRevision != previousRevision || revealsSection { sessionDidChange() }
    return result
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> TerminalTabMoveResult? {
    guard let instance = spaceManager.instance(for: id) else { return nil }
    let previousRevision = instance.tabCollection.topologyRevision
    guard
      let result = instance.tabCollection.setTabPinned(
        id,
        isPinned: isPinned,
        orderedProjectIDs: projectCatalog.projects.map(\.id)
      )
    else { return nil }
    if result.topologyRevision != previousRevision { sessionDidChange() }
    return result
  }

  @discardableResult
  func removeTabFromProject(_ id: TerminalTabID) -> Bool {
    assignTabs([id], to: nil)
  }

  @discardableResult
  func assignTabs(_ ids: [TerminalTabID], to projectID: TerminalProjectID?) -> Bool {
    if let onProjectAssignment { return onProjectAssignment(ids, projectID) }
    if let projectID, !projectCatalog.projects.contains(where: { $0.id == projectID }) {
      return false
    }
    guard let instance = spaceManager.sharedInstance(containing: ids) else { return false }
    let changed = instance.tabCollection.assign(
      ids,
      to: projectID,
      orderedProjectIDs: projectCatalog.projects.map(\.id)
    )
    if changed {
      if let projectID {
        instance.collapsedProjectIDs.remove(projectID)
      } else {
        instance.isUnassignedCollapsed = false
      }
      sessionDidChange()
    }
    return changed
  }

  @discardableResult
  func clearProjectMembership(_ id: TerminalProjectID) -> Bool {
    var changed = false
    for instance in spaceManager.instances {
      let tabIDs = instance.tabCollection.canonicalTabs.compactMap {
        $0.projectID == id ? $0.id : nil
      }
      guard !tabIDs.isEmpty else { continue }
      changed =
        instance.tabCollection.assign(
          tabIDs,
          to: nil,
          orderedProjectIDs: projectCatalog.projects.map(\.id)
        ) || changed
      instance.collapsedProjectIDs.remove(id)
      instance.isUnassignedCollapsed = false
    }
    if changed { sessionDidChange() }
    return changed
  }
}
