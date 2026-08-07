import Foundation
import SupaTheme
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
  var color: ThemeTint

  init(
    id: TerminalSpaceID = TerminalSpaceID(),
    name: String,
    color: ThemeTint = .neutral
  ) {
    self.id = id
    self.name = name
    self.color = color
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(TerminalSpaceID.self, forKey: .id)
    name = try container.decode(String.self, forKey: .name)
    color = try container.decodeIfPresent(ThemeTint.self, forKey: .color) ?? .neutral
  }
}

nonisolated struct TerminalSpaceCatalog: Equatable, Codable, Sendable {
  var defaultSelectedSpaceID: TerminalSpaceID
  var spaces: [TerminalSpaceItem]

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

  func spaceID(adjacentTo spaceID: TerminalSpaceID, step: Int) -> TerminalSpaceID? {
    guard let index = spaces.firstIndex(where: { $0.id == spaceID }) else { return nil }
    return spaces[(index + step + spaces.count) % spaces.count].id
  }

  @discardableResult
  mutating func moveSpace(_ spaceID: TerminalSpaceID, toInsertionIndex insertionIndex: Int) -> Bool {
    guard let sourceIndex = spaces.firstIndex(where: { $0.id == spaceID }) else { return false }
    let space = spaces.remove(at: sourceIndex)
    var destinationIndex = min(max(0, insertionIndex), spaces.count + 1)
    if insertionIndex > sourceIndex {
      destinationIndex -= 1
    }
    destinationIndex = min(destinationIndex, spaces.count)
    spaces.insert(space, at: destinationIndex)
    return sourceIndex != destinationIndex
  }

  static func sanitized(_ catalog: Self?) -> Self {
    guard let catalog else { return .default }

    let spaces = catalog.spaces.compactMap { space -> TerminalSpaceItem? in
      let trimmedName = space.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedName.isEmpty else { return nil }
      return TerminalSpaceItem(
        id: space.id,
        name: trimmedName,
        color: space.color
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
    let space = TerminalSpaceItem(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!),
      name: "Space 1"
    )
    return Self(
      defaultSelectedSpaceID: space.id,
      spaces: [space]
    )
  }
}
