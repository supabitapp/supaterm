import Foundation

public struct SupatermCustomCommandsFile: Equatable, Sendable, Codable {
  public var schema: String?
  public var commands: [SupatermCustomCommand]

  public init(
    schema: String? = SupatermCustomCommandsSchema.url,
    commands: [SupatermCustomCommand]
  ) {
    self.schema = schema
    self.commands = commands
  }

  private enum CodingKeys: String, CodingKey {
    case schema = "$schema"
    case commands
  }
}

public struct SupatermCustomCommand: Equatable, Sendable, Codable, Identifiable {
  public let id: String
  public let kind: Kind
  public let name: String
  public let description: String?
  public let keywords: [String]
  public let command: String?
  public let restartBehavior: SupatermWorkspaceRestartBehavior?
  public let workspace: SupatermWorkspaceDefinition?

  public enum Kind: String, Equatable, Sendable, Codable {
    case command
    case workspace
  }

  public init(
    id: String,
    kind: Kind,
    name: String,
    description: String? = nil,
    keywords: [String] = [],
    command: String? = nil,
    restartBehavior: SupatermWorkspaceRestartBehavior? = nil,
    workspace: SupatermWorkspaceDefinition? = nil
  ) {
    self.id = id
    self.kind = kind
    self.name = name
    self.description = description
    self.keywords = keywords
    self.command = command
    self.restartBehavior = restartBehavior
    self.workspace = workspace
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case kind
    case name
    case description
    case keywords
    case command
    case restartBehavior
    case workspace
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let id = try container.decode(String.self, forKey: .id)
    let kind = try container.decode(Kind.self, forKey: .kind)
    let name = try container.decode(String.self, forKey: .name)
    let description = try container.decodeIfPresent(String.self, forKey: .description)
    let keywords = try container.decodeIfPresent([String].self, forKey: .keywords) ?? []
    let command = try container.decodeIfPresent(String.self, forKey: .command)
    let restartBehavior = try container.decodeIfPresent(
      SupatermWorkspaceRestartBehavior.self,
      forKey: .restartBehavior
    )
    let workspace = try container.decodeIfPresent(SupatermWorkspaceDefinition.self, forKey: .workspace)

    switch kind {
    case .command:
      guard command != nil else {
        throw DecodingError.dataCorruptedError(
          forKey: .command,
          in: container,
          debugDescription: "Command entries require a command string."
        )
      }
    case .workspace:
      guard workspace != nil else {
        throw DecodingError.dataCorruptedError(
          forKey: .workspace,
          in: container,
          debugDescription: "Workspace entries require a workspace definition."
        )
      }
    }

    self.init(
      id: id,
      kind: kind,
      name: name,
      description: description,
      keywords: keywords,
      command: command,
      restartBehavior: restartBehavior,
      workspace: workspace
    )
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(kind, forKey: .kind)
    try container.encode(name, forKey: .name)
    try container.encodeIfPresent(description, forKey: .description)
    if !keywords.isEmpty {
      try container.encode(keywords, forKey: .keywords)
    }
    switch kind {
    case .command:
      try container.encode(command, forKey: .command)
    case .workspace:
      try container.encode(restartBehavior ?? .focusExisting, forKey: .restartBehavior)
      try container.encode(workspace, forKey: .workspace)
    }
  }
}

public enum SupatermWorkspaceRestartBehavior: String, Equatable, Sendable, Codable, CaseIterable {
  case focusExisting = "focus_existing"
  case recreate
  case confirmRecreate = "confirm_recreate"
}

public struct SupatermWorkspaceDefinition: Equatable, Sendable, Codable {
  public let spaceName: String
  public let tabs: [SupatermWorkspaceTabDefinition]

  public init(
    spaceName: String,
    tabs: [SupatermWorkspaceTabDefinition]
  ) {
    self.spaceName = spaceName
    self.tabs = tabs
  }
}

public struct SupatermWorkspaceTabDefinition: Equatable, Sendable, Codable {
  public let title: String
  public let cwd: String?
  public let selected: Bool
  public let rootPane: SupatermWorkspacePaneDefinition

  public init(
    title: String,
    cwd: String? = nil,
    selected: Bool = false,
    rootPane: SupatermWorkspacePaneDefinition
  ) {
    self.title = title
    self.cwd = cwd
    self.selected = selected
    self.rootPane = rootPane
  }
}

public enum SupatermWorkspaceSplitDirection: String, Equatable, Sendable, Codable, CaseIterable {
  case left
  case right
  case up
  case down
}

public struct SupatermWorkspaceEnvironment: Equatable, Sendable, Codable {
  public let values: [String: String]

  public init(_ values: [String: String] = [:]) {
    self.values = values
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    self.init(try container.decode([String: String].self))
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(values)
  }
}

public struct SupatermWorkspaceLeafPaneDefinition: Equatable, Sendable, Codable {
  public let title: String?
  public let cwd: String?
  public let command: String?
  public let focus: Bool
  public let env: SupatermWorkspaceEnvironment

  public init(
    title: String? = nil,
    cwd: String? = nil,
    command: String? = nil,
    focus: Bool = false,
    env: SupatermWorkspaceEnvironment = .init()
  ) {
    self.title = title
    self.cwd = cwd
    self.command = command
    self.focus = focus
    self.env = env
  }
}

public struct SupatermWorkspaceSplitPaneDefinition: Equatable, Sendable, Codable {
  public let direction: SupatermWorkspaceSplitDirection
  public let ratio: Double
  public let first: SupatermWorkspacePaneDefinition
  public let second: SupatermWorkspacePaneDefinition

  public init(
    direction: SupatermWorkspaceSplitDirection,
    ratio: Double,
    first: SupatermWorkspacePaneDefinition,
    second: SupatermWorkspacePaneDefinition
  ) {
    self.direction = direction
    self.ratio = ratio
    self.first = first
    self.second = second
  }
}

public indirect enum SupatermWorkspacePaneDefinition: Equatable, Sendable, Codable {
  case leaf(SupatermWorkspaceLeafPaneDefinition)
  case split(SupatermWorkspaceSplitPaneDefinition)

  private enum CodingKeys: String, CodingKey {
    case type
    case title
    case cwd
    case command
    case focus
    case env
    case direction
    case ratio
    case first
    case second
  }

  private enum Kind: String, Codable {
    case leaf
    case split
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .leaf:
      self = .leaf(
        .init(
          title: try container.decodeIfPresent(String.self, forKey: .title),
          cwd: try container.decodeIfPresent(String.self, forKey: .cwd),
          command: try container.decodeIfPresent(String.self, forKey: .command),
          focus: try container.decodeIfPresent(Bool.self, forKey: .focus) ?? false,
          env: try container.decodeIfPresent(SupatermWorkspaceEnvironment.self, forKey: .env) ?? .init()
        )
      )
    case .split:
      self = .split(
        .init(
          direction: try container.decode(SupatermWorkspaceSplitDirection.self, forKey: .direction),
          ratio: try container.decodeIfPresent(Double.self, forKey: .ratio) ?? 0.5,
          first: try container.decode(SupatermWorkspacePaneDefinition.self, forKey: .first),
          second: try container.decode(SupatermWorkspacePaneDefinition.self, forKey: .second)
        )
      )
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .leaf(let leaf):
      try container.encode(Kind.leaf, forKey: .type)
      try container.encodeIfPresent(leaf.title, forKey: .title)
      try container.encodeIfPresent(leaf.cwd, forKey: .cwd)
      try container.encodeIfPresent(leaf.command, forKey: .command)
      if leaf.focus {
        try container.encode(leaf.focus, forKey: .focus)
      }
      if !leaf.env.values.isEmpty {
        try container.encode(leaf.env, forKey: .env)
      }
    case .split(let split):
      try container.encode(Kind.split, forKey: .type)
      try container.encode(split.direction, forKey: .direction)
      try container.encode(split.ratio, forKey: .ratio)
      try container.encode(split.first, forKey: .first)
      try container.encode(split.second, forKey: .second)
    }
  }
}
