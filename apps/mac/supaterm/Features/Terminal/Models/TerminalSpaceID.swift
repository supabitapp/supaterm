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
    self.projects = projects ?? [TerminalProjectItem(name: NSHomeDirectory())]
  }
}

nonisolated struct TerminalSpaceCatalog: Equatable, Codable, Sendable {
  var defaultSelectedSpaceID: TerminalSpaceID
  var spaces: [PersistedTerminalSpace]

  static let `default` = Self.makeDefault()

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
    var seenNames: Set<String> = []
    let projects = projects.compactMap { project -> TerminalProjectItem? in
      let name = project.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !name.isEmpty else { return nil }
      guard seenIDs.insert(project.id).inserted else { return nil }
      guard seenNames.insert(name.folding(options: [.caseInsensitive], locale: .current)).inserted
      else { return nil }
      return TerminalProjectItem(
        id: project.id,
        name: name,
        isPinned: project.isPinned
      )
    }
    let resolved = projects.isEmpty ? [TerminalProjectItem(name: NSHomeDirectory())] : projects
    return resolved.filter(\.isPinned) + resolved.filter { !$0.isPinned }
  }
}
