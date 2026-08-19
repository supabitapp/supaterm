import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension TerminalHostState {
  func debugAgentSnapshot(
    for surfaceID: UUID
  ) -> (status: SupatermAppDebugSnapshot.AgentDetectionStatus, agent: SupatermAppDebugSnapshot.Agent?) {
    debugAgentSnapshot(
      for: surfaceID,
      explanation: agentDetectionExplanation(for: surfaceID)
    )
  }

  func debugAgentSnapshot(
    for surfaceID: UUID,
    explanation: TerminalAgentDetectionExplanation
  ) -> (status: SupatermAppDebugSnapshot.AgentDetectionStatus, agent: SupatermAppDebugSnapshot.Agent?) {
    let resolvedState = resolvedAgentState(for: surfaceID)
    switch resolvedState.resolution {
    case .native:
      guard let candidate = resolvedState.currentNativeCandidate else {
        return (
          explanation.status == .detected
            ? .waiting
            : debugAgentStatus(explanation.status),
          nil
        )
      }
      let observation = agentDetectionStore.observation(for: surfaceID)
      let phaseAuthority = candidate.phaseAuthorityProcessIdentities
      let exactAuthorityProcess =
        explanation.processIdentity.flatMap { processIdentity in
          phaseAuthority.contains(processIdentity)
            ? processIdentity
            : nil
        }
        ?? observation.flatMap { observation in
          phaseAuthority.contains(observation.processIdentity)
            ? observation.processIdentity
            : nil
        }
      let singleAuthorityProcess =
        phaseAuthority.count == 1
        ? phaseAuthority.first
        : nil
      let processIdentity = exactAuthorityProcess ?? singleAuthorityProcess
      return (
        phaseAuthority.isEmpty ? .resolved : .nativeAuthority,
        SupatermAppDebugSnapshot.Agent(
          kind: candidate.presentation.agent,
          phase: debugAgentPhase(candidate.presentation.phase),
          phaseSource: .native,
          sessionID: candidate.presentation.sessionID,
          process: processIdentity.map(debugAgentProcess)
        )
      )
    case .terminal(let observation, let nativeDetails):
      guard let kind = SupatermAgentKind(rawValue: observation.agent.id) else {
        return (debugAgentStatus(explanation.status), nil)
      }
      return (
        debugAgentStatus(explanation.status),
        SupatermAppDebugSnapshot.Agent(
          kind: kind,
          phase: debugAgentPhase(observation.phase),
          phaseSource: .screen,
          sessionID: nativeDetails?.presentation.sessionID,
          ruleID: observation.ruleID,
          process: debugAgentProcess(observation.processIdentity)
        )
      )
    }
  }

  private func debugAgentProcess(
    _ identity: TerminalAgentProcessIdentity
  ) -> SupatermAppDebugSnapshot.AgentProcess {
    SupatermAppDebugSnapshot.AgentProcess(
      processID: identity.processID,
      startTimeMicroseconds: identity.startTimeMicroseconds
    )
  }

  private func debugAgentStatus(
    _ status: TerminalAgentDetectionExplanation.Status
  ) -> SupatermAppDebugSnapshot.AgentDetectionStatus {
    switch status {
    case .detected: .resolved
    case .disabled: .detectionDisabled
    case .nativeAuthority: .nativeAuthority
    case .noForegroundProcess: .noForegroundProcess
    case .noRuleMatchOrSettling: .noRuleMatchOrSettling
    case .protectedOrUnreadableScreen: .screenUnavailable
    case .unrecognizedProcess: .unrecognizedProcess
    case .waiting: .waiting
    }
  }
}
