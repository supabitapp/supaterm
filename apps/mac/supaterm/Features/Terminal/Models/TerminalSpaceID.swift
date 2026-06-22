import Foundation
import SupatermCLIShared

public nonisolated struct TerminalSpaceID: Hashable, Identifiable, Codable, Sendable {
  public let rawValue: UUID

  public init() {
    rawValue = UUID()
  }

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  public var id: UUID { rawValue }
}

public nonisolated struct TerminalSpaceItem: Identifiable, Equatable, Codable, Sendable {
  public let id: TerminalSpaceID
  public var name: String

  public init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
  }
}

public nonisolated struct PersistedTerminalSpace: Equatable, Codable, Sendable {
  public let id: TerminalSpaceID
  public var name: String

  public init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String
  ) {
    self.id = id
    self.name = name
  }
}

public nonisolated struct TerminalSpaceCatalog: Equatable, Codable, Sendable {
  public var defaultSelectedSpaceID: TerminalSpaceID
  public var spaces: [PersistedTerminalSpace]

  public static let `default` = Self.makeDefault()

  public init(
    defaultSelectedSpaceID: TerminalSpaceID,
    spaces: [PersistedTerminalSpace]
  ) {
    self.defaultSelectedSpaceID = defaultSelectedSpaceID
    self.spaces = spaces
  }

  public static func defaultURL(
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
