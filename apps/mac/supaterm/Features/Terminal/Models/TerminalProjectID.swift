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
}

nonisolated struct TerminalProjectItem: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalProjectID
  var name: String
  var isPinned: Bool

  init(
    id: TerminalProjectID = TerminalProjectID(),
    name: String,
    isPinned: Bool = false
  ) {
    self.id = id
    self.name = name
    self.isPinned = isPinned
  }
}
