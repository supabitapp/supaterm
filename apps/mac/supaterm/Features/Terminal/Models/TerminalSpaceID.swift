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

  init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
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

    let spaces = catalog.spaces.compactMap { space -> PersistedTerminalSpace? in
      let trimmedName = space.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }
      return PersistedTerminalSpace(id: space.id, name: trimmedName)
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
}
