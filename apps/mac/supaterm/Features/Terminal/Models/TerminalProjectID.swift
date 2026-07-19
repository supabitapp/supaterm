import Foundation

nonisolated struct TerminalProjectID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  var id: UUID { rawValue }

  static func home(for spaceID: TerminalSpaceID) -> Self {
    Self(rawValue: spaceID.rawValue)
  }
}

nonisolated enum TerminalProjectKind: String, Codable, Sendable {
  case home
  case folder
}

nonisolated struct TerminalProjectItem: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalProjectID
  let folderPath: String
  var isPinned: Bool
  let kind: TerminalProjectKind

  init(
    id: TerminalProjectID = TerminalProjectID(),
    folderPath: String,
    isPinned: Bool = false,
    kind: TerminalProjectKind = .folder
  ) {
    self.id = id
    self.folderPath = folderPath
    self.isPinned = isPinned
    self.kind = kind
  }

  var isHome: Bool {
    kind == .home
  }

  var baseDisplayName: String {
    guard !isHome else { return "Home" }
    let name = URL(fileURLWithPath: folderPath, isDirectory: true).lastPathComponent
    return name.isEmpty ? folderPath : name
  }

  static func home(
    for spaceID: TerminalSpaceID,
    folderPath: String = NSHomeDirectory()
  ) -> Self {
    Self(
      id: .home(for: spaceID),
      folderPath: folderPath,
      kind: .home
    )
  }
}
