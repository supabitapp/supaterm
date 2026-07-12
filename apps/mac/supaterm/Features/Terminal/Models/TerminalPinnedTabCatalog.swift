import Foundation
import SupatermCLIShared

nonisolated struct PersistedPinnedTerminalTabsForProject: Equatable, Codable, Sendable {
  let id: TerminalProjectID
  var tabs: [PersistedTerminalTab]
}

nonisolated struct PersistedPinnedTerminalTabsForSpace: Equatable, Codable, Sendable {
  let id: TerminalSpaceID
  var projects: [PersistedPinnedTerminalTabsForProject]
}

nonisolated struct TerminalPinnedTabCatalog: Equatable, Codable, Sendable {
  var spaces: [PersistedPinnedTerminalTabsForSpace]

  static let `default` = Self(spaces: [])

  static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "pinned-tabs.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  static func sanitized(
    _ catalog: Self?,
    validProjectIDsBySpaceID: [TerminalSpaceID: Set<TerminalProjectID>]
  ) -> Self {
    guard let catalog else { return .default }

    var seenSpaceIDs: Set<TerminalSpaceID> = []
    var seenTabIDs: Set<TerminalTabID> = []
    let spaces = catalog.spaces.compactMap { space -> PersistedPinnedTerminalTabsForSpace? in
      guard seenSpaceIDs.insert(space.id).inserted else { return nil }
      guard let validProjectIDs = validProjectIDsBySpaceID[space.id] else { return nil }
      var seenProjectIDs: Set<TerminalProjectID> = []
      let projects = space.projects.compactMap { project -> PersistedPinnedTerminalTabsForProject? in
        guard validProjectIDs.contains(project.id) else { return nil }
        guard seenProjectIDs.insert(project.id).inserted else { return nil }
        let tabs = project.tabs.compactMap { tab -> PersistedTerminalTab? in
          guard seenTabIDs.insert(tab.id).inserted else { return nil }
          guard let session = tab.session.pruned() else { return nil }
          return PersistedTerminalTab(id: tab.id, session: session)
        }
        guard !tabs.isEmpty else { return nil }
        return PersistedPinnedTerminalTabsForProject(id: project.id, tabs: tabs)
      }
      guard !projects.isEmpty else { return nil }
      return PersistedPinnedTerminalTabsForSpace(id: space.id, projects: projects)
    }

    return Self(spaces: spaces)
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  func projects(in spaceID: TerminalSpaceID) -> [PersistedPinnedTerminalTabsForProject] {
    spaces.first(where: { $0.id == spaceID })?.projects ?? []
  }

  func tabs(in spaceID: TerminalSpaceID) -> [PersistedTerminalTab] {
    projects(in: spaceID).flatMap(\.tabs)
  }

  func tabs(in projectID: TerminalProjectID, spaceID: TerminalSpaceID) -> [PersistedTerminalTab] {
    projects(in: spaceID).first(where: { $0.id == projectID })?.tabs ?? []
  }

  var surfaceIDs: Set<UUID> {
    spaces.reduce(into: Set<UUID>()) { result, space in
      for tab in space.projects.flatMap(\.tabs) {
        result.formUnion(tab.session.surfaceIDs)
      }
    }
  }

  func updatingProjects(
    _ projects: [PersistedPinnedTerminalTabsForProject],
    in spaceID: TerminalSpaceID
  ) -> Self {
    var spaces = spaces
    if let index = spaces.firstIndex(where: { $0.id == spaceID }) {
      if projects.isEmpty {
        spaces.remove(at: index)
      } else {
        spaces[index].projects = projects
      }
    } else if !projects.isEmpty {
      spaces.append(PersistedPinnedTerminalTabsForSpace(id: spaceID, projects: projects))
    }
    return Self(spaces: spaces)
  }
}
