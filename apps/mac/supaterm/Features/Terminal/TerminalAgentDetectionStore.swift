import Foundation
import SupatermCLIShared
import SupatermSupport

extension AgentDetectionAgentIdentity {
  nonisolated init(_ agent: SupatermAgentKind) {
    self.init(id: agent.rawValue, displayName: agent.notificationTitle)
  }
}

nonisolated struct TerminalAgentDetectionObservation: Equatable, Sendable {
  let agent: AgentDetectionAgentIdentity
  let phase: AgentActivityPhase
  let processIdentity: TerminalAgentProcessIdentity
  let ruleID: String
  let generation: UInt64
  let sequence: UInt64
}

nonisolated struct TerminalAgentDetectionNativeCandidate: Equatable, Sendable {
  let presentation: TerminalAgentStatePresentation
  let revision: Int
  let processIdentities: Set<TerminalAgentProcessIdentity>
}

nonisolated enum TerminalAgentDetectionResolution: Equatable, Sendable {
  case native([TerminalAgentDetectionNativeCandidate])
  case terminal(
    TerminalAgentDetectionObservation,
    nativeDetails: TerminalAgentDetectionNativeCandidate?
  )
}

nonisolated struct TerminalAgentDetectionStore {
  private var observationsBySurfaceID: [UUID: TerminalAgentDetectionObservation] = [:]
  private var processMatchesBySurfaceID: [UUID: AgentDetectionProcessMatch] = [:]

  func observation(for surfaceID: UUID) -> TerminalAgentDetectionObservation? {
    observationsBySurfaceID[surfaceID]
  }

  func processMatch(for surfaceID: UUID) -> AgentDetectionProcessMatch? {
    processMatchesBySurfaceID[surfaceID]
  }

  @discardableResult
  mutating func apply(
    _ observation: TerminalAgentDetectionObservation,
    for surfaceID: UUID
  ) -> Bool {
    if let current = observationsBySurfaceID[surfaceID] {
      guard observation.sequence > current.sequence else { return false }
    }
    observationsBySurfaceID[surfaceID] = observation
    return true
  }

  @discardableResult
  mutating func clear(for surfaceID: UUID) -> Bool {
    observationsBySurfaceID.removeValue(forKey: surfaceID) != nil
  }

  @discardableResult
  mutating func applyProcessMatch(
    _ match: AgentDetectionProcessMatch,
    for surfaceID: UUID
  ) -> Bool {
    guard processMatchesBySurfaceID[surfaceID] != match else { return false }
    processMatchesBySurfaceID[surfaceID] = match
    return true
  }

  @discardableResult
  mutating func clearProcessMatch(for surfaceID: UUID) -> Bool {
    processMatchesBySurfaceID.removeValue(forKey: surfaceID) != nil
  }

  mutating func take(_ surfaceIDs: Set<UUID>) -> TerminalAgentDetectionStore {
    var taken = TerminalAgentDetectionStore()
    for surfaceID in surfaceIDs {
      if let observation = observationsBySurfaceID.removeValue(forKey: surfaceID) {
        taken.observationsBySurfaceID[surfaceID] = observation
      }
      if let processMatch = processMatchesBySurfaceID.removeValue(forKey: surfaceID) {
        taken.processMatchesBySurfaceID[surfaceID] = processMatch
      }
    }
    return taken
  }

  mutating func merge(_ other: TerminalAgentDetectionStore) {
    precondition(
      observationsBySurfaceID.keys.allSatisfy { other.observationsBySurfaceID[$0] == nil }
        && processMatchesBySurfaceID.keys.allSatisfy { other.processMatchesBySurfaceID[$0] == nil }
    )
    observationsBySurfaceID.merge(other.observationsBySurfaceID) { _, incoming in incoming }
    processMatchesBySurfaceID.merge(other.processMatchesBySurfaceID) { _, incoming in incoming }
  }

  mutating func pruneDeadProcesses(
    isProcessCurrent: (TerminalAgentProcessIdentity) -> Bool
  ) -> Set<UUID> {
    let deadObservationSurfaceIDs = Set(
      observationsBySurfaceID.compactMap { surfaceID, observation in
        isProcessCurrent(observation.processIdentity) ? nil : surfaceID
      })
    let deadProcessMatchSurfaceIDs = Set(
      processMatchesBySurfaceID.compactMap { surfaceID, match in
        isProcessCurrent(match.processIdentity) ? nil : surfaceID
      })
    for surfaceID in deadObservationSurfaceIDs {
      observationsBySurfaceID.removeValue(forKey: surfaceID)
    }
    for surfaceID in deadProcessMatchSurfaceIDs {
      processMatchesBySurfaceID.removeValue(forKey: surfaceID)
    }
    return deadObservationSurfaceIDs.union(deadProcessMatchSurfaceIDs)
  }

  func resolve(
    for surfaceID: UUID,
    nativeCandidates: [TerminalAgentDetectionNativeCandidate]
  ) -> TerminalAgentDetectionResolution {
    let observation = observationsBySurfaceID[surfaceID]
    guard let observation else {
      return .native(nativeCandidates)
    }
    let nativeDetails =
      nativeCandidates
      .filter {
        AgentDetectionAgentIdentity($0.presentation.agent).id == observation.agent.id
          && $0.processIdentities.contains(observation.processIdentity)
      }
      .max { $0.revision < $1.revision }
    return .terminal(observation, nativeDetails: nativeDetails)
  }
}
