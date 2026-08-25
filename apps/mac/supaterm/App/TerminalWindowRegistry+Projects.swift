import Foundation
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalWindowRegistry {
  func execute(_ request: TerminalProjectRequest) throws -> TerminalProjectResult {
    switch request {
    case .add(let request):
      return .project(try addProject(request))

    case .pin(let target):
      return .project(try setProjectPinned(target, isPinned: true))

    case .unpin(let target):
      return .project(try setProjectPinned(target, isPinned: false))

    case .rename(let request):
      return .project(try renameProject(request))

    case .setColor(let request):
      return .project(try setProjectColor(request))

    case .reorder(let request):
      return .project(try reorderProject(request))

    case .setCollapsed(let request):
      return .collapsed(try setProjectCollapsed(request))

    case .moveTab(let request):
      return .movedTab(try moveProjectTab(request))

    case .remove(let request):
      let id = TerminalProjectID(rawValue: request.target.projectID)
      return .removedProject(try removeProject(id, confirmed: request.confirmed))
    }
  }

  private func addProject(
    _ request: SupatermAddProjectRequest
  ) throws -> SupatermProjectMutationResult {
    guard let entry = preferredActiveEntry() ?? activeEntries().first else {
      throw TerminalControlError.contextPaneNotFound
    }
    guard
      let result = createProject(
        name: request.name,
        rootPath: request.rootPath,
        color: request.color.map(ThemeTint.init(socketColor:)) ?? .neutral,
        isPinned: request.isPinned,
        in: entry.windowControllerID
      )
    else { throw TerminalControlError.invalidProjectName }
    return try projectMutationResult(result.projectID)
  }

  private func setProjectPinned(
    _ target: SupatermProjectTargetRequest,
    isPinned: Bool
  ) throws -> SupatermProjectMutationResult {
    let id = TerminalProjectID(rawValue: target.projectID)
    guard setProjectPinned(id, isPinned: isPinned) else {
      throw TerminalControlError.projectNotFound(id.rawValue)
    }
    return try projectMutationResult(id)
  }

  private func renameProject(
    _ request: SupatermRenameProjectRequest
  ) throws -> SupatermProjectMutationResult {
    let id = TerminalProjectID(rawValue: request.target.projectID)
    guard projectCatalog.projects.contains(where: { $0.id == id }) else {
      throw TerminalControlError.projectNotFound(id.rawValue)
    }
    guard renameProject(id, name: request.name) else {
      throw TerminalControlError.invalidProjectName
    }
    return try projectMutationResult(id)
  }

  private func setProjectColor(
    _ request: SupatermSetProjectColorRequest
  ) throws -> SupatermProjectMutationResult {
    let id = TerminalProjectID(rawValue: request.target.projectID)
    guard setProjectColor(id, color: ThemeTint(socketColor: request.color)) else {
      throw TerminalControlError.projectNotFound(id.rawValue)
    }
    return try projectMutationResult(id)
  }

  private func reorderProject(
    _ request: SupatermReorderProjectRequest
  ) throws -> SupatermProjectMutationResult {
    let id = TerminalProjectID(rawValue: request.target.projectID)
    guard projectCatalog.projects.contains(where: { $0.id == id }) else {
      throw TerminalControlError.projectNotFound(id.rawValue)
    }
    guard reorderProject(id, toLaneIndex: request.index - 1) else {
      throw TerminalControlError.invalidProjectIndex(request.index - 1)
    }
    return try projectMutationResult(id)
  }

  private func setProjectCollapsed(
    _ request: SupatermSetProjectCollapsedRequest
  ) throws -> SupatermSetProjectCollapsedResult {
    let spaceID = TerminalSpaceID(rawValue: request.spaceID)
    guard
      let terminal = activeEntries().lazy.map(\.terminal).first(where: {
        $0.spaceManager.instance(for: spaceID) != nil
      })
    else { throw TerminalControlError.contextPaneNotFound }
    let changed =
      if let projectID = request.projectID {
        terminal.setProjectCollapsed(
          TerminalProjectID(rawValue: projectID),
          isCollapsed: request.isCollapsed,
          in: spaceID
        )
      } else {
        terminal.setUnassignedCollapsed(request.isCollapsed, in: spaceID)
      }
    guard changed else { throw TerminalControlError.contextPaneNotFound }
    return SupatermSetProjectCollapsedResult(
      isCollapsed: request.isCollapsed,
      projectID: request.projectID,
      spaceID: request.spaceID
    )
  }

  private func moveProjectTab(
    _ request: SupatermMoveTabRequest
  ) throws -> SupatermMoveTabResult {
    guard let entry = activeEntries().first(where: { $0.terminal.containsTab(request.target.tabID) })
    else { throw TerminalControlError.contextPaneNotFound }
    return try entry.terminal.moveProjectTab(request)
  }

  @discardableResult
  func createProject(
    name: String,
    rootPath: String? = nil,
    color: ThemeTint = .neutral,
    isPinned: Bool = false,
    containing tabIDs: [TerminalTabID] = [],
    in windowControllerID: UUID
  ) -> TerminalProjectCreationResult? {
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
      guard
        let terminal = entry(forWindowControllerID: windowControllerID)?.terminal,
        let instance = terminal.spaceManager.sharedInstance(containing: tabIDs),
        instance.tabCollection.assign(
          tabIDs,
          to: project.id,
          orderedProjectIDs: catalog.projects.map(\.id)
        )
      else { return nil }
      instance.collapsedProjectIDs.remove(project.id)
      terminal.sessionDidChange()
    }
    $projectCatalog.withLock { $0 = catalog }
    return TerminalProjectCreationResult(projectID: project.id)
  }

  @discardableResult
  func renameProject(_ projectID: TerminalProjectID, name: String) -> Bool {
    var catalog = projectCatalog
    guard let index = catalog.projects.firstIndex(where: { $0.id == projectID }) else {
      return false
    }
    catalog.projects[index].name = name
    guard let validated = try? catalog.validated() else { return false }
    $projectCatalog.withLock { $0 = validated }
    return true
  }

  @discardableResult
  func setProjectColor(_ projectID: TerminalProjectID, color: ThemeTint) -> Bool {
    guard let index = projectCatalog.projects.firstIndex(where: { $0.id == projectID }) else {
      return false
    }
    $projectCatalog.withLock { $0.projects[index].color = color }
    return true
  }

  @discardableResult
  func setProjectPinned(_ projectID: TerminalProjectID, isPinned: Bool) -> Bool {
    var catalog = projectCatalog
    guard let project = catalog.projects.first(where: { $0.id == projectID }) else { return false }
    guard project.isPinned != isPinned else { return true }
    guard catalog.setPinned(projectID, isPinned: isPinned) else { return false }
    $projectCatalog.withLock { $0 = catalog }
    return true
  }

  @discardableResult
  func reorderProject(_ projectID: TerminalProjectID, toLaneIndex index: Int) -> Bool {
    var catalog = projectCatalog
    guard let project = catalog.projects.first(where: { $0.id == projectID }) else { return false }
    let lane = catalog.projects.filter { $0.isPinned == project.isPinned }
    guard lane.indices.contains(index) else { return false }
    guard lane[index].id != projectID else { return true }
    guard catalog.reorderProject(projectID, toLaneIndex: index) else { return false }
    $projectCatalog.withLock { $0 = catalog }
    return true
  }

  @discardableResult
  func assignTabs(
    _ tabIDs: [TerminalTabID],
    to projectID: TerminalProjectID?,
    in windowControllerID: UUID
  ) -> Bool {
    if let projectID, !projectCatalog.projects.contains(where: { $0.id == projectID }) {
      return false
    }
    guard
      let terminal = entry(forWindowControllerID: windowControllerID)?.terminal,
      let instance = terminal.spaceManager.sharedInstance(containing: tabIDs),
      instance.tabCollection.assign(
        tabIDs,
        to: projectID,
        orderedProjectIDs: projectCatalog.projects.map(\.id)
      )
    else { return false }
    if let projectID {
      instance.collapsedProjectIDs.remove(projectID)
    } else {
      instance.isUnassignedCollapsed = false
    }
    terminal.sessionDidChange()
    return true
  }

  @discardableResult
  func requestRemoveProject(_ projectID: TerminalProjectID, from windowControllerID: UUID) -> Bool {
    guard projectCatalog.projects.contains(where: { $0.id == projectID }) else { return false }
    let tabIDs = projectTabIDs(projectID)
    if tabIDs.isEmpty {
      $projectCatalog.withLock { $0.projects.removeAll { $0.id == projectID } }
      return true
    }
    guard let entry = entry(forWindowControllerID: windowControllerID) else { return false }
    entry.terminal.emit(
      .closeRequested(TerminalCloseRequest(target: .project(projectID), needsConfirmation: true))
    )
    return true
  }

  func removeProject(
    _ projectID: TerminalProjectID,
    confirmed: Bool
  ) throws -> SupatermRemoveProjectResult {
    guard projectCatalog.projects.contains(where: { $0.id == projectID }) else {
      throw TerminalControlError.projectNotFound(projectID.rawValue)
    }
    let entries = activeEntries()
    let tabIDs = projectTabIDs(projectID, in: entries)
    guard tabIDs.isEmpty || confirmed else {
      throw TerminalControlError.projectCloseConfirmationRequired
    }
    let affectedEntries = entries.filter { !$0.terminal.tabIDs(in: projectID).isEmpty }
    for entry in affectedEntries {
      entry.terminal.withSessionChangesSuppressed {
        entry.terminal.performCloseProject(projectID)
      }
    }
    affectedEntries.first?.terminal.sessionDidChange()
    $projectCatalog.withLock { $0.projects.removeAll { $0.id == projectID } }
    for entry in affectedEntries where entry.terminal.spaceManager.allTabs.isEmpty {
      entry.requestConfirmedWindowClose()
    }
    return SupatermRemoveProjectResult(
      removedProjectID: projectID.rawValue,
      removedTabIDs: tabIDs.map(\.rawValue)
    )
  }

  private func projectTabIDs(_ projectID: TerminalProjectID) -> [TerminalTabID] {
    projectTabIDs(projectID, in: activeEntries())
  }

  private func projectTabIDs(
    _ projectID: TerminalProjectID,
    in entries: [Entry]
  ) -> [TerminalTabID] {
    var seen: Set<TerminalTabID> = []
    return entries.flatMap { entry in
      entry.terminal.tabIDs(in: projectID).filter { seen.insert($0).inserted }
    }
  }

  private func projectMutationResult(
    _ projectID: TerminalProjectID
  ) throws -> SupatermProjectMutationResult {
    guard let project = projectCatalog.projects.first(where: { $0.id == projectID }) else {
      throw TerminalControlError.projectNotFound(projectID.rawValue)
    }
    return SupatermProjectMutationResult(project: project.socketSnapshot)
  }
}
