import Foundation
import SupatermCLIShared
import SupatermSupport

extension TerminalHostState {
  func debugAgentDetectionExplainResult(
    target: SupatermPaneTarget,
    explanation: TerminalAgentDetectionDetail
  ) -> SupatermAgentDetectionExplainResult {
    let summary = explanation.summary
    let evaluation = explanation.evaluation
    let agent = evaluation?.identity ?? summary.agent
    return SupatermAgentDetectionExplainResult(
      target: target,
      status: debugAgentStatus(summary.status),
      generation: summary.generation,
      agentID: agent?.id,
      displayName: agent?.displayName,
      phase: summary.publishedPhase.map(debugAgentPhase),
      process: summary.processIdentity.map(debugAgentProcess),
      manifest: evaluation.map(\.manifest.socketInfo),
      matchedRuleID: evaluation?.explanation.match.ruleID ?? summary.matchedRuleID,
      publishedRuleID: summary.publishedRuleID,
      rules: evaluation?.explanation.rules.map(ruleEvidence) ?? []
    )
  }

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
        phaseAuthority.isEmpty ? screenStatus : .nativeAuthority,
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
    case .nativeAuthority: .nativeAuthority
    case .noForegroundProcess: .noForegroundProcess
    case .noRuleMatchOrSettling: .noRuleMatchOrSettling
    case .protectedOrUnreadableScreen: .screenUnavailable
    case .unrecognizedProcess: .unrecognizedProcess
    case .waiting: .waiting
    }
  }

  private func ruleEvidence(
    _ evidence: AgentDetectionRuleEvidence
  ) -> SupatermAgentDetectionRuleEvidence {
    SupatermAgentDetectionRuleEvidence(
      ruleID: evidence.ruleID,
      state: ruleState(evidence.result),
      priority: evidence.priority,
      region: evidence.region,
      matched: evidence.matched,
      condition: conditionEvidence(evidence.condition)
    )
  }

  private func conditionEvidence(
    _ evidence: AgentDetectionConditionEvidence
  ) -> SupatermAgentDetectionConditionEvidence {
    SupatermAgentDetectionConditionEvidence(
      kind: evidence.kind,
      value: evidence.value,
      matched: evidence.matched,
      children: evidence.children.map(conditionEvidence)
    )
  }

  private func ruleState(
    _ result: AgentDetectionRuleResult
  ) -> SupatermAgentDetectionRuleState {
    switch result {
    case .unknown: .unknown
    case .idle: .idle
    case .running: .running
    case .needsInput: .needsInput
    case .hold: .hold
    }
  }
}
