import Foundation

public enum SupatermTabGroupColor: String, CaseIterable, Equatable, Sendable, Codable {
  case neutral
  case red
  case orange
  case yellow
  case green
  case blue
  case pink
  case purple
}

public enum SupatermTabGroupDestination: Equatable, Sendable, Codable {
  case group(UUID)
  case root(isPinned: Bool)

  private enum CodingKeys: String, CodingKey {
    case groupID
    case isPinned
    case kind
  }

  private enum Kind: String, Codable {
    case group
    case root
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .group:
      self = .group(try container.decode(UUID.self, forKey: .groupID))
    case .root:
      self = .root(isPinned: try container.decode(Bool.self, forKey: .isPinned))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .group(let groupID):
      try container.encode(Kind.group, forKey: .kind)
      try container.encode(groupID, forKey: .groupID)
    case .root(let isPinned):
      try container.encode(Kind.root, forKey: .kind)
      try container.encode(isPinned, forKey: .isPinned)
    }
  }
}

public struct SupatermCreateTabGroupRequest: Equatable, Sendable, Codable {
  public let color: SupatermTabGroupColor
  public let isPinned: Bool
  public let target: SupatermSpaceTargetRequest
  public let title: String

  public init(
    color: SupatermTabGroupColor,
    isPinned: Bool,
    target: SupatermSpaceTargetRequest,
    title: String
  ) {
    self.color = color
    self.isPinned = isPinned
    self.target = target
    self.title = title
  }
}

public struct SupatermTabGroupTargetRequest: Equatable, Sendable, Codable {
  public let groupID: UUID

  public init(groupID: UUID) {
    self.groupID = groupID
  }
}

public struct SupatermRenameTabGroupRequest: Equatable, Sendable, Codable {
  public let title: String
  public let target: SupatermTabGroupTargetRequest

  public init(
    title: String,
    target: SupatermTabGroupTargetRequest
  ) {
    self.title = title
    self.target = target
  }
}

public struct SupatermSetTabGroupColorRequest: Equatable, Sendable, Codable {
  public let color: SupatermTabGroupColor
  public let target: SupatermTabGroupTargetRequest

  public init(
    color: SupatermTabGroupColor,
    target: SupatermTabGroupTargetRequest
  ) {
    self.color = color
    self.target = target
  }
}

public struct SupatermMoveTabGroupRequest: Equatable, Sendable, Codable {
  public let index: Int
  public let target: SupatermTabGroupTargetRequest

  public init(
    index: Int,
    target: SupatermTabGroupTargetRequest
  ) {
    self.index = index
    self.target = target
  }
}

public struct SupatermMoveTabRequest: Equatable, Sendable, Codable {
  public let destination: SupatermTabGroupDestination
  public let index: Int?
  public let target: SupatermTabTargetRequest

  public init(
    destination: SupatermTabGroupDestination,
    index: Int? = nil,
    target: SupatermTabTargetRequest
  ) {
    self.destination = destination
    self.index = index
    self.target = target
  }
}

public struct SupatermTabGroupMutationResult: Equatable, Sendable, Codable {
  public let group: SupatermTreeSnapshot.Group
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID

  public init(
    group: SupatermTreeSnapshot.Group,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID
  ) {
    self.group = group
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
  }
}

public struct SupatermRemoveTabGroupResult: Equatable, Sendable, Codable {
  public let removedGroupID: UUID
  public let spaceID: UUID
  public let spaceIndex: Int
  public let windowIndex: Int

  public init(
    removedGroupID: UUID,
    spaceID: UUID,
    spaceIndex: Int,
    windowIndex: Int
  ) {
    self.removedGroupID = removedGroupID
    self.spaceID = spaceID
    self.spaceIndex = spaceIndex
    self.windowIndex = windowIndex
  }
}

public struct SupatermMoveTabResult: Equatable, Sendable, Codable {
  public let target: SupatermTabTarget

  public init(target: SupatermTabTarget) {
    self.target = target
  }
}
