import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated enum TerminalAgentCompletionIdentity: Equatable, Sendable {
  case native(agent: SupatermAgentKind, sessionID: String)
  case screen(
    agent: AgentDetectionAgentIdentity,
    processIdentity: TerminalAgentProcessIdentity
  )
}

struct TerminalAgentCompletionStore {
  private var identitiesBySurfaceID: [UUID: TerminalAgentCompletionIdentity] = [:]

  func contains(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) -> Bool {
    identitiesBySurfaceID[surfaceID] == identity
  }

  func identity(for surfaceID: UUID) -> TerminalAgentCompletionIdentity? {
    identitiesBySurfaceID[surfaceID]
  }

  mutating func record(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) {
    identitiesBySurfaceID[surfaceID] = identity
  }

  mutating func clear(for surfaceID: UUID) {
    identitiesBySurfaceID.removeValue(forKey: surfaceID)
  }

  mutating func clear(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) {
    guard contains(identity, for: surfaceID) else { return }
    clear(for: surfaceID)
  }

  mutating func take(_ surfaceIDs: Set<UUID>) -> TerminalAgentCompletionStore {
    var taken = TerminalAgentCompletionStore()
    for surfaceID in surfaceIDs {
      if let identity = identitiesBySurfaceID.removeValue(forKey: surfaceID) {
        taken.identitiesBySurfaceID[surfaceID] = identity
      }
    }
    return taken
  }

  mutating func merge(_ other: TerminalAgentCompletionStore) {
    precondition(identitiesBySurfaceID.keys.allSatisfy { other.identitiesBySurfaceID[$0] == nil })
    identitiesBySurfaceID.merge(other.identitiesBySurfaceID) { _, incoming in incoming }
  }
}
