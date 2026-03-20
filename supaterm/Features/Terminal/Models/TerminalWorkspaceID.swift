import Foundation

nonisolated struct TerminalWorkspaceID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  var id: UUID { rawValue }
}

nonisolated struct TerminalWorkspaceItem: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalWorkspaceID
  var name: String

  init(
    id: TerminalWorkspaceID = TerminalWorkspaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
  }
}

nonisolated struct PersistedTerminalWorkspace: Equatable, Codable, Sendable {
  let id: TerminalWorkspaceID
  var name: String

  init(
    id: TerminalWorkspaceID = TerminalWorkspaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
  }
}

nonisolated struct TerminalWorkspaceCatalog: Equatable, Codable, Sendable {
  var defaultSelectedWorkspaceID: TerminalWorkspaceID
  var workspaces: [PersistedTerminalWorkspace]

  static let `default` = Self.makeDefault()

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("workspaces.json", isDirectory: false)
  }

  static func sanitized(_ catalog: Self?) -> Self {
    guard let catalog else { return .default }

    let workspaces = catalog.workspaces.compactMap { workspace -> PersistedTerminalWorkspace? in
      let trimmedName = workspace.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }
      return PersistedTerminalWorkspace(id: workspace.id, name: trimmedName)
    }
    guard !workspaces.isEmpty else { return .default }

    let defaultSelectedWorkspaceID =
      workspaces.contains(where: { $0.id == catalog.defaultSelectedWorkspaceID })
      ? catalog.defaultSelectedWorkspaceID
      : workspaces[0].id

    return Self(
      defaultSelectedWorkspaceID: defaultSelectedWorkspaceID,
      workspaces: workspaces
    )
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  private static func makeDefault() -> Self {
    let workspace = PersistedTerminalWorkspace(
      id: TerminalWorkspaceID(),
      name: "A"
    )
    return Self(
      defaultSelectedWorkspaceID: workspace.id,
      workspaces: [workspace]
    )
  }
}
