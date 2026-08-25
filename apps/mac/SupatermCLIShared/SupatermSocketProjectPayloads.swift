import Foundation

public struct SupatermProjectTargetRequest: Equatable, Sendable, Codable {
  public let projectID: UUID

  public init(projectID: UUID) {
    self.projectID = projectID
  }
}

public struct SupatermAddProjectRequest: Equatable, Sendable, Codable {
  public let color: SupatermThemeColor?
  public let isPinned: Bool
  public let name: String
  public let rootPath: String?

  public init(
    color: SupatermThemeColor? = nil,
    isPinned: Bool = false,
    name: String,
    rootPath: String? = nil
  ) {
    self.color = color
    self.isPinned = isPinned
    self.name = name
    self.rootPath = rootPath
  }
}

public struct SupatermRenameProjectRequest: Equatable, Sendable, Codable {
  public let name: String
  public let target: SupatermProjectTargetRequest

  public init(name: String, target: SupatermProjectTargetRequest) {
    self.name = name
    self.target = target
  }
}

public struct SupatermSetProjectColorRequest: Equatable, Sendable, Codable {
  public let color: SupatermThemeColor
  public let target: SupatermProjectTargetRequest

  public init(color: SupatermThemeColor, target: SupatermProjectTargetRequest) {
    self.color = color
    self.target = target
  }
}

public struct SupatermReorderProjectRequest: Equatable, Sendable, Codable {
  public let index: Int
  public let target: SupatermProjectTargetRequest

  public init(index: Int, target: SupatermProjectTargetRequest) {
    self.index = index
    self.target = target
  }
}

public struct SupatermRemoveProjectRequest: Equatable, Sendable, Codable {
  public let confirmed: Bool
  public let target: SupatermProjectTargetRequest

  public init(confirmed: Bool, target: SupatermProjectTargetRequest) {
    self.confirmed = confirmed
    self.target = target
  }
}

public struct SupatermSetProjectCollapsedRequest: Equatable, Sendable, Codable {
  public let isCollapsed: Bool
  public let projectID: UUID?
  public let spaceID: UUID

  public init(isCollapsed: Bool, projectID: UUID?, spaceID: UUID) {
    self.isCollapsed = isCollapsed
    self.projectID = projectID
    self.spaceID = spaceID
  }
}

public struct SupatermMoveTabRequest: Equatable, Sendable, Codable {
  public let index: Int?
  public let isPinned: Bool
  public let projectID: UUID?
  public let target: SupatermTabTargetRequest

  public init(
    index: Int? = nil,
    isPinned: Bool,
    projectID: UUID?,
    target: SupatermTabTargetRequest
  ) {
    self.index = index
    self.isPinned = isPinned
    self.projectID = projectID
    self.target = target
  }
}

public struct SupatermProjectMutationResult: Equatable, Sendable, Codable {
  public let project: SupatermSnapshotProject

  public init(project: SupatermSnapshotProject) {
    self.project = project
  }
}

public struct SupatermRemoveProjectResult: Equatable, Sendable, Codable {
  public let removedProjectID: UUID
  public let removedTabIDs: [UUID]

  public init(removedProjectID: UUID, removedTabIDs: [UUID]) {
    self.removedProjectID = removedProjectID
    self.removedTabIDs = removedTabIDs
  }
}

public struct SupatermMoveTabResult: Equatable, Sendable, Codable {
  public let target: SupatermTabTarget

  public init(target: SupatermTabTarget) {
    self.target = target
  }
}
