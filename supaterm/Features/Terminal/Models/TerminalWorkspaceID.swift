import Foundation

struct TerminalWorkspaceID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  var id: UUID { rawValue }
}

struct TerminalWorkspaceItem: Identifiable, Equatable, Codable, Sendable {
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

struct PersistedTerminalWorkspace: Equatable, Codable, Sendable {
  let id: TerminalWorkspaceID
  let name: String
}

struct TerminalWorkspaceSnapshot: Equatable, Codable, Sendable {
  let selectedWorkspaceID: TerminalWorkspaceID
  let workspaces: [PersistedTerminalWorkspace]
}
