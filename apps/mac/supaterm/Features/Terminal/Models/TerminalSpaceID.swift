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
  var projects: [TerminalProjectItem]

  init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String,
    projects: [TerminalProjectItem]? = nil
  ) {
    self.id = id
    self.name = name
    self.projects = projects ?? [.home(for: id)]
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
    self.projects = projects ?? [.home(for: id)]
  }
}

nonisolated struct TerminalSpaceCatalog: Equatable, Codable, Sendable {
  static let currentVersion = 1

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
        debugDescription: "Unsupported spaces version: \(version)"
      )
    }
    self.version = Self.currentVersion
    self.defaultSelectedSpaceID = try container.decode(
      TerminalSpaceID.self,
      forKey: .defaultSelectedSpaceID
    )
    self.spaces = try container.decode([PersistedTerminalSpace].self, forKey: .spaces)
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

  static func sanitized(
    _ catalog: Self?,
    homeDirectoryPath: String = NSHomeDirectory()
  ) -> Self {
    guard let catalog, catalog.version == currentVersion else {
      return makeDefault(homeDirectoryPath: homeDirectoryPath)
    }

    let spaces = catalog.spaces.compactMap { space -> PersistedTerminalSpace? in
      let trimmedName = space.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }

      var seenProjectIDs: Set<TerminalProjectID> = []
      var hasHome = false
      var projects: [TerminalProjectItem] = []
      for project in space.projects {
        guard seenProjectIDs.insert(project.id).inserted else { continue }
        switch project.kind {
        case .home:
          guard !hasHome else { continue }
          hasHome = true
          projects.append(
            TerminalProjectItem(
              id: project.id,
              folderPath: homeDirectoryPath,
              isPinned: project.isPinned,
              kind: .home
            )
          )
        case .folder:
          guard let folderPath = normalizedAbsolutePath(project.folderPath) else { continue }
          projects.append(
            TerminalProjectItem(
              id: project.id,
              folderPath: folderPath,
              isPinned: project.isPinned,
              kind: .folder
            )
          )
        }
      }

      if !hasHome {
        let home = TerminalProjectItem.home(for: space.id, folderPath: homeDirectoryPath)
        projects.removeAll { $0.id == home.id }
        projects.append(home)
      }
      projects = pinnedFirst(projects)

      return PersistedTerminalSpace(
        id: space.id,
        name: trimmedName,
        projects: projects
      )
    }
    guard !spaces.isEmpty else { return makeDefault(homeDirectoryPath: homeDirectoryPath) }

    let defaultSelectedSpaceID =
      spaces.contains(where: { $0.id == catalog.defaultSelectedSpaceID })
      ? catalog.defaultSelectedSpaceID
      : spaces[0].id

    return Self(
      defaultSelectedSpaceID: defaultSelectedSpaceID,
      spaces: spaces
    )
  }

  func orderedProjects(in spaceID: TerminalSpaceID) -> [TerminalProjectItem] {
    guard let projects = spaces.first(where: { $0.id == spaceID })?.projects else { return [] }
    return Self.pinnedFirst(projects)
  }

  func displayName(
    for projectID: TerminalProjectID,
    in spaceID: TerminalSpaceID
  ) -> String? {
    let projects = orderedProjects(in: spaceID)
    guard let project = projects.first(where: { $0.id == projectID }) else { return nil }
    guard !project.isHome else { return "Home" }
    let name = project.baseDisplayName
    let hasDuplicate = projects.contains {
      $0.id != project.id && !$0.isHome && $0.baseDisplayName == name
    }
    guard hasDuplicate else { return name }
    let parent = URL(fileURLWithPath: project.folderPath, isDirectory: true)
      .deletingLastPathComponent()
      .lastPathComponent
    return parent.isEmpty ? name : "\(name) (\(parent))"
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDefault(
    homeDirectoryPath: String = NSHomeDirectory()
  ) -> Self {
    let spaceID = TerminalSpaceID(
      rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
    )
    let space = PersistedTerminalSpace(
      id: spaceID,
      name: "1",
      projects: [.home(for: spaceID, folderPath: homeDirectoryPath)]
    )
    return Self(
      defaultSelectedSpaceID: space.id,
      spaces: [space]
    )
  }

  private static func normalizedAbsolutePath(_ path: String) -> String? {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, NSString(string: trimmed).isAbsolutePath else { return nil }
    return URL(fileURLWithPath: trimmed, isDirectory: true).standardizedFileURL.path
  }

  private static func pinnedFirst(_ projects: [TerminalProjectItem]) -> [TerminalProjectItem] {
    projects.filter(\.isPinned) + projects.filter { !$0.isPinned }
  }
}
