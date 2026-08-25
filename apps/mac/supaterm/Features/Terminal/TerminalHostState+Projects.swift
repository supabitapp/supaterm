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
        return session.tabs.filter { $0.projectID == projectID }.map(\.id)
      }
      return instance.tabCollection.canonicalTabs.filter { $0.projectID == projectID }.map(\.id)
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
    projectActions.create(name, rootPath, color, isPinned, tabIDs)
  }

  @discardableResult
  func renameProject(_ id: TerminalProjectID, name: String) -> Bool {
    projectActions.rename(id, name)
  }

  @discardableResult
  func setProjectColor(_ id: TerminalProjectID, color: ThemeTint) -> Bool {
    projectActions.setColor(id, color)
  }

  @discardableResult
  func setProjectPinned(_ id: TerminalProjectID, isPinned: Bool) -> Bool {
    projectActions.setPinned(id, isPinned)
  }

  @discardableResult
  func reorderProject(_ id: TerminalProjectID, toLaneIndex index: Int) -> Bool {
    projectActions.reorder(id, index)
  }

  func moveProjectTab(_ request: SupatermMoveTabRequest) throws -> SupatermMoveTabResult {
    let tabID = TerminalTabID(rawValue: request.target.tabID)
    let projectID = request.projectID.map(TerminalProjectID.init(rawValue:))
    let orderedProjectIDs = projectCatalog.projects.map(\.id)
    if let instance = spaceManager.instance(for: tabID) {
      let destination = projectTabDestination(
        request,
        projectID: projectID,
        orderedProjectIDs: orderedProjectIDs,
        pinnedTabs: instance.tabCollection.snapshot.pinnedTabs.map {
          SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
        },
        regularTabs: instance.tabCollection.snapshot.regularTabs.map {
          SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
        }
      )
      _ = try move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: instance.tabCollection.topologyRevision,
          orderedProjectIDs: orderedProjectIDs,
          tabIDs: [tabID],
          destination: destination
        )
      )
    } else if let instance = spaceManager.pendingInstance(containingTab: tabID) {
      try movePendingProjectTab(
        tabID,
        request: request,
        projectID: projectID,
        orderedProjectIDs: orderedProjectIDs,
        in: instance
      )
    } else {
      throw TerminalControlError.contextPaneNotFound
    }
    return SupatermMoveTabResult(target: try tabTarget(for: tabID))
  }

  private func movePendingProjectTab(
    _ tabID: TerminalTabID,
    request: SupatermMoveTabRequest,
    projectID: TerminalProjectID?,
    orderedProjectIDs: [TerminalProjectID],
    in instance: TerminalSpaceInstance
  ) throws {
    guard var session = instance.pendingSession else {
      throw TerminalControlError.contextPaneNotFound
    }
    let pinnedTabs = session.tabs.filter(\.isPinned).map {
      SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
    }
    let regularTabs = session.tabs.filter { !$0.isPinned }.map {
      SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
    }
    let destination = projectTabDestination(
      request,
      projectID: projectID,
      orderedProjectIDs: orderedProjectIDs,
      pinnedTabs: pinnedTabs,
      regularTabs: regularTabs
    )
    let result: SupatermProjectTabMoveResult<TerminalTabID, TerminalProjectID>
    do {
      result = try SupatermProjectLayout.move(
        orderedProjectIDs: orderedProjectIDs,
        pinnedTabs: pinnedTabs,
        regularTabs: regularTabs,
        movingTabIDs: [tabID],
        destination: destination
      )
    } catch SupatermProjectTabMoveError.unknownProject {
      throw TerminalTabMoveError.staleProjects
    } catch {
      throw TerminalTabMoveError.invalidDestination(destination)
    }
    var tabsByID = Dictionary(uniqueKeysWithValues: session.tabs.map { ($0.id, $0) })
    for record in result.pinnedTabs {
      tabsByID[record.id]?.projectID = record.projectID
      tabsByID[record.id]?.isPinned = true
    }
    for record in result.regularTabs {
      tabsByID[record.id]?.projectID = record.projectID
      tabsByID[record.id]?.isPinned = false
    }
    session.tabs = (result.pinnedTabs + result.regularTabs).compactMap { tabsByID[$0.id] }
    if let projectID {
      session.collapsedProjectIDs.removeAll { $0 == projectID }
    } else {
      session.isUnassignedCollapsed = false
    }
    instance.pendingSession = session
    sessionDidChange()
  }

  private func projectTabDestination(
    _ request: SupatermMoveTabRequest,
    projectID: TerminalProjectID?,
    orderedProjectIDs: [TerminalProjectID],
    pinnedTabs: [SupatermProjectTabRecord<TerminalTabID, TerminalProjectID>],
    regularTabs: [SupatermProjectTabRecord<TerminalTabID, TerminalProjectID>]
  ) -> TerminalTabPlacement {
    let knownProjectIDs = Set(orderedProjectIDs)
    let lane = request.isPinned ? pinnedTabs : regularTabs
    let destinationCount = lane.count { tab in
      guard tab.id.rawValue != request.target.tabID else { return false }
      if let projectID { return tab.projectID == projectID }
      return tab.projectID.map(knownProjectIDs.contains) != true
    }
    return TerminalTabPlacement(
      projectID: projectID,
      isPinned: request.isPinned,
      index: request.index.map { $0 - 1 } ?? destinationCount
    )
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
      if isCollapsed {
        changed = collapsed.insert(id).inserted
      } else {
        changed = collapsed.remove(id) != nil
      }
      session.collapsedProjectIDs = Array(collapsed)
      instance.pendingSession = session
    } else {
      if isCollapsed {
        changed = instance.collapsedProjectIDs.insert(id).inserted
      } else {
        changed = instance.collapsedProjectIDs.remove(id) != nil
      }
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
    let movesSelectedTab = request.tabIDs.contains { instance.tabCollection.selectedTabID == $0 }
    let result = try instance.tabCollection.move(request)
    if movesSelectedTab {
      if let projectID = request.destination.projectID {
        instance.collapsedProjectIDs.remove(projectID)
      } else {
        instance.isUnassignedCollapsed = false
      }
    }
    if result.topologyRevision != previousRevision || movesSelectedTab { sessionDidChange() }
    return result
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> TerminalTabMoveResult? {
    guard let instance = spaceManager.instance(for: id) else { return nil }
    guard
      let result = instance.tabCollection.setTabPinned(
        id,
        isPinned: isPinned,
        orderedProjectIDs: projectCatalog.projects.map(\.id)
      )
    else { return nil }
    sessionDidChange()
    return result
  }

  @discardableResult
  func removeTabFromProject(_ id: TerminalTabID) -> Bool {
    assignTabs([id], to: nil)
  }

  @discardableResult
  func assignTabs(_ ids: [TerminalTabID], to projectID: TerminalProjectID?) -> Bool {
    projectActions.assign(ids, projectID)
  }

}
