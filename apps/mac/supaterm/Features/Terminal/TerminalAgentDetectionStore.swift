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
  let phaseAuthorityProcessIdentities: Set<TerminalAgentProcessIdentity>
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

  func observation(for surfaceID: UUID) -> TerminalAgentDetectionObservation? {
    observationsBySurfaceID[surfaceID]
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

  mutating func take(_ surfaceIDs: Set<UUID>) -> TerminalAgentDetectionStore {
    var taken = TerminalAgentDetectionStore()
    for surfaceID in surfaceIDs {
      if let observation = observationsBySurfaceID.removeValue(forKey: surfaceID) {
        taken.observationsBySurfaceID[surfaceID] = observation
      }
    }
    return taken
  }

  mutating func merge(_ other: TerminalAgentDetectionStore) {
    precondition(
      observationsBySurfaceID.keys.allSatisfy { other.observationsBySurfaceID[$0] == nil }
    )
    observationsBySurfaceID.merge(other.observationsBySurfaceID) { _, incoming in incoming }
  }

  mutating func pruneDeadProcesses(
    isProcessCurrent: (TerminalAgentProcessIdentity) -> Bool
  ) -> Set<UUID> {
    let deadSurfaceIDs = Set(
      observationsBySurfaceID.compactMap { surfaceID, observation in
        isProcessCurrent(observation.processIdentity) ? nil : surfaceID
      })
    for surfaceID in deadSurfaceIDs {
      observationsBySurfaceID.removeValue(forKey: surfaceID)
    }
    return deadSurfaceIDs
  }

  func resolve(
    for surfaceID: UUID,
    nativeCandidates: [TerminalAgentDetectionNativeCandidate],
    provenProcessIdentity: TerminalAgentProcessIdentity? = nil
  ) -> TerminalAgentDetectionResolution {
    let observation = observationsBySurfaceID[surfaceID]
    let exactProcessIdentity = provenProcessIdentity ?? observation?.processIdentity
    let authoritativeCandidates = nativeCandidates.filter { candidate in
      guard let exactProcessIdentity else {
        return !candidate.phaseAuthorityProcessIdentities.isEmpty
      }
      return candidate.phaseAuthorityProcessIdentities.contains(exactProcessIdentity)
    }
    if !authoritativeCandidates.isEmpty {
      return .native(authoritativeCandidates)
    }
    guard let observation else {
      return .native(nativeCandidates)
    }
    let nativeDetails =
      nativeCandidates
      .filter {
        AgentDetectionAgentIdentity($0.presentation.agent).id == observation.agent.id
          && $0.processIdentities.contains(observation.processIdentity)
          && $0.phaseAuthorityProcessIdentities.isEmpty
      }
      .max { $0.revision < $1.revision }
    return .terminal(observation, nativeDetails: nativeDetails)
  }
}
