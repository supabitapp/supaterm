import Foundation
import SupatermCLIShared
import SupatermSupport

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
      let screenStatus: SupatermAppDebugSnapshot.AgentDetectionStatus =
        explanation.status == .detected
        ? .waiting
        : debugAgentStatus(explanation.status)
      guard let candidate = resolvedState.currentNativeCandidate else {
        return (
          screenStatus,
          resolvedState.currentInstance.flatMap(debugCessationAgent)
        )
      }
      return (
        screenStatus,
        SupatermAppDebugSnapshot.Agent(
          kind: candidate.presentation.agent,
          phase: debugAgentPhase(candidate.presentation.phase),
          phaseSource: .native,
          sessionID: candidate.presentation.sessionID,
          process: nil
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

  private func debugCessationAgent(
    _ instance: AgentStateInstance
  ) -> SupatermAppDebugSnapshot.Agent? {
    guard case .ceased(let exitCode) = instance.lifecycle else { return nil }
    guard let kind = SupatermAgentKind(rawValue: instance.activity.identity.id) else {
      return nil
    }
    let sessionID: String?
    let process: SupatermAppDebugSnapshot.AgentProcess?
    switch instance.completionIdentity {
    case .native(_, let value):
      sessionID = value
      process = nil
    case .screen(_, let identity):
      sessionID = nil
      process = debugAgentProcess(identity)
    }
    return SupatermAppDebugSnapshot.Agent(
      kind: kind,
      phase: debugAgentPhase(instance.activity.phase),
      phaseSource: instance.phaseSource == .native ? .native : .screen,
      sessionID: sessionID,
      ruleID: exitCode == 0 ? "process_exit_success" : "process_exit_unknown",
      process: process
    )
  }

  private func debugAgentStatus(
    _ status: TerminalAgentDetectionExplanation.Status
  ) -> SupatermAppDebugSnapshot.AgentDetectionStatus {
    switch status {
    case .detected: .resolved
    case .disabled: .detectionDisabled
    case .noForegroundProcess: .noForegroundProcess
    case .noRuleMatchOrSettling: .noRuleMatchOrSettling
    case .protectedOrUnreadableScreen: .screenUnavailable
    case .unrecognizedProcess: .unrecognizedProcess
    case .waiting: .waiting
    }
  }
}
