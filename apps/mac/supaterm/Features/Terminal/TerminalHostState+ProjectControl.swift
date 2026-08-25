import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalHostState {
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
      return .project(try setProjectCollapsed(request))

    case .moveTab(let request):
      return .movedTab(try moveProjectTab(request))

    case .remove(let request):
      return .removedProject(try removeProject(request))
    }
  }

  private func addProject(
    _ request: SupatermAddProjectRequest
  ) throws -> SupatermProjectMutationResult {
    guard
      let result = createProject(
        name: request.name,
        rootPath: request.rootPath,
        color: request.color.map(ThemeTint.init(socketColor:)) ?? .neutral,
        isPinned: request.isPinned
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
    guard reorderProject(id, toLaneIndex: request.index - 1) else {
      throw TerminalControlError.invalidProjectIndex(request.index - 1)
    }
    return try projectMutationResult(id)
  }

  private func setProjectCollapsed(
    _ request: SupatermSetProjectCollapsedRequest
  ) throws -> SupatermProjectMutationResult {
    let spaceID = TerminalSpaceID(rawValue: request.spaceID)
    let changed =
      if let projectID = request.projectID {
        setProjectCollapsed(
          TerminalProjectID(rawValue: projectID),
          isCollapsed: request.isCollapsed,
          in: spaceID
        )
      } else {
        setUnassignedCollapsed(request.isCollapsed, in: spaceID)
      }
    guard changed else { throw TerminalControlError.contextPaneNotFound }
    let project =
      request.projectID.flatMap { id in
        projectCatalog.projects.first { $0.id.rawValue == id }
      } ?? projectCatalog.projects.first
    guard let project else { throw TerminalControlError.contextPaneNotFound }
    return try projectMutationResult(project.id)
  }

  private func moveProjectTab(
    _ request: SupatermMoveTabRequest
  ) throws -> SupatermMoveTabResult {
    let tabID = TerminalTabID(rawValue: request.target.tabID)
    guard let instance = spaceManager.instance(for: tabID) else {
      throw TerminalControlError.contextPaneNotFound
    }
    let projectID = request.projectID.map(TerminalProjectID.init(rawValue:))
    let orderedProjectIDs = projectCatalog.projects.map(\.id)
    let knownProjectIDs = Set(orderedProjectIDs)
    let lane =
      request.isPinned
      ? instance.tabCollection.snapshot.pinnedTabs
      : instance.tabCollection.snapshot.regularTabs
    let destinationCount = lane.count { tab in
      if let projectID { return tab.projectID == projectID }
      return tab.projectID.map(knownProjectIDs.contains) != true
    }
    _ = try move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: instance.tabCollection.topologyRevision,
        orderedProjectIDs: orderedProjectIDs,
        tabIDs: [tabID],
        destination: TerminalTabPlacement(
          projectID: projectID,
          isPinned: request.isPinned,
          index: request.index.map { $0 - 1 } ?? destinationCount
        )
      )
    )
    return SupatermMoveTabResult(target: try tabTarget(for: tabID))
  }

  private func removeProject(
    _ request: SupatermRemoveProjectRequest
  ) throws -> SupatermRemoveProjectResult {
    let id = TerminalProjectID(rawValue: request.target.projectID)
    let tabIDs = spaceManager.instances.flatMap { instance in
      instance.tabCollection.canonicalTabs.filter { $0.projectID == id }.map(\.id)
    }
    guard tabIDs.isEmpty || request.confirmed else {
      throw TerminalControlError.projectCloseConfirmationRequired
    }
    performCloseProject(id)
    $projectCatalog.withLock { $0.projects.removeAll { $0.id == id } }
    return SupatermRemoveProjectResult(
      removedProjectID: id.rawValue,
      removedTabIDs: tabIDs.map(\.rawValue)
    )
  }

  private func projectMutationResult(_ id: TerminalProjectID) throws -> SupatermProjectMutationResult {
    guard let project = projectCatalog.projects.first(where: { $0.id == id }) else {
      throw TerminalControlError.projectNotFound(id.rawValue)
    }
    return SupatermProjectMutationResult(project: project.socketSnapshot)
  }
}
