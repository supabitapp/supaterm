import Foundation
import SupatermCLIShared

nonisolated struct TerminalSpaceID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  var id: UUID { rawValue }
}

nonisolated struct TerminalSpaceItem: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalSpaceID
  var name: String

  init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
  }
}

nonisolated struct PersistedTerminalSpace: Equatable, Codable, Sendable {
  let id: TerminalSpaceID
  var name: String
  var projects: [TerminalProjectItem]

  init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String,
    projects: [TerminalProjectItem]? = nil
  ) {
    self.id = id
    self.name = name
    self.projects =
      projects ?? [
        TerminalProjectItem(
          directoryURL: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        )
      ]
  }
}

nonisolated struct TerminalSpaceCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 2

  let version: Int
  var defaultSelectedSpaceID: TerminalSpaceID
  var spaces: [PersistedTerminalSpace]

  static let `default` = Self.makeDefault()

  init(
    version: Int = Self.currentVersion,
    defaultSelectedSpaceID: TerminalSpaceID,
    spaces: [PersistedTerminalSpace]
  ) {
    self.version = version
    self.defaultSelectedSpaceID = defaultSelectedSpaceID
    self.spaces = spaces
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let version = try container.decode(Int.self, forKey: .version)
    guard version == Self.currentVersion else {
      throw DecodingError.dataCorruptedError(
        forKey: .version,
        in: container,
        debugDescription: "Unsupported space catalog version: \(version)"
      )
    }
    self.version = Self.currentVersion
    defaultSelectedSpaceID = try container.decode(
      TerminalSpaceID.self,
      forKey: .defaultSelectedSpaceID
    )
    spaces = try container.decode([PersistedTerminalSpace].self, forKey: .spaces)
  }

  static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "spaces.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  static func sanitized(_ catalog: Self?) -> Self {
    guard let catalog else { return .default }

    var seenSpaceIDs: Set<TerminalSpaceID> = []
    let spaces = catalog.spaces.compactMap { space -> PersistedTerminalSpace? in
      guard seenSpaceIDs.insert(space.id).inserted else { return nil }
      let trimmedName = space.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }
      let projects = sanitizedProjects(space.projects)
      return PersistedTerminalSpace(
        id: space.id,
        name: trimmedName,
        projects: projects
      )
    }
    guard !spaces.isEmpty else { return .default }

    let defaultSelectedSpaceID =
      spaces.contains(where: { $0.id == catalog.defaultSelectedSpaceID })
      ? catalog.defaultSelectedSpaceID
      : spaces[0].id

    return Self(
      defaultSelectedSpaceID: defaultSelectedSpaceID,
      spaces: spaces
    )
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDefault() -> Self {
    let space = PersistedTerminalSpace(
      id: TerminalSpaceID(),
      name: "1"
    )
    return Self(
      defaultSelectedSpaceID: space.id,
      spaces: [space]
    )
  }

  private static func sanitizedProjects(
    _ projects: [TerminalProjectItem]
  ) -> [TerminalProjectItem] {
    var seenIDs: Set<TerminalProjectID> = []
    var seenDirectoryURLs: Set<URL> = []
    let projects = projects.compactMap { project -> TerminalProjectItem? in
      guard let directoryURL = TerminalProjectItem.canonicalDirectoryURL(project.directoryURL) else {
        return nil
      }
      guard seenIDs.insert(project.id).inserted else { return nil }
      guard seenDirectoryURLs.insert(directoryURL).inserted else { return nil }
      return TerminalProjectItem(
        id: project.id,
        directoryURL: directoryURL,
        isPinned: project.isPinned
      )
    }
    return projects.filter(\.isPinned) + projects.filter { !$0.isPinned }
  }
}
