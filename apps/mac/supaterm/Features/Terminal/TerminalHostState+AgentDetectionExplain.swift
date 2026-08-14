import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension TerminalHostState {
  func agentDetectionExplain(
    _ target: TerminalPaneTarget
  ) throws -> SupatermAgentExplainResult {
    let resolvedTarget = try resolvePaneTarget(target)
    let surfaceID = resolvedTarget.anchorSurface.id
    let resolvedPane = try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: surfaceID,
      tree: resolvedTarget.tree
    )
    return agentDetectionExplain(
      target: resolvedPane,
      surfaceID: surfaceID,
      explanation: agentDetectionExplanation(for: surfaceID)
    )
  }

  func agentDetectionExplain(
    target: SupatermPaneTarget,
    surfaceID: UUID,
    explanation: TerminalAgentDetectionExplanation
  ) -> SupatermAgentExplainResult {
    let resolvedState = resolvedAgentState(for: surfaceID)
    switch resolvedState.resolution {
    case .native:
      guard let candidate = resolvedState.currentNativeCandidate else {
        return unresolvedAgentDetectionExplain(
          target: target,
          explanation: explanation
        )
      }
      let observation = agentDetectionStore.observation(for: surfaceID)
      let exactAuthorityProcess =
        explanation.processIdentity.flatMap { processIdentity in
          candidate.authorityProcessIdentities.contains(processIdentity)
            ? processIdentity
            : nil
        }
        ?? observation.flatMap { observation in
          candidate.authorityProcessIdentities.contains(observation.processIdentity)
            ? observation.processIdentity
            : nil
        }
      let singleAuthorityProcess =
        candidate.authorityProcessIdentities.count == 1
        ? candidate.authorityProcessIdentities.first
        : nil
      let processIdentity = exactAuthorityProcess ?? singleAuthorityProcess
      let presentation = candidate.presentation
      return SupatermAgentExplainResult(
        target: target,
        mode: .native,
        status: candidate.authorityProcessIdentities.isEmpty ? .resolved : .nativeAuthority,
        rules: agentExplainRules(explanation),
        agent: SupatermAgentExplainResult.Agent(
          id: presentation.agent.rawValue,
          displayName: presentation.agent.notificationTitle,
          phase: agentExplainPhase(presentation.phase)
        ),
        process: processIdentity.map(agentExplainProcess),
        ruleID: nil
      )
    case .fallback(let observation, _):
      let rules =
        explanation.generation == observation.generation
        ? agentExplainRules(explanation)
        : nil
      return SupatermAgentExplainResult(
        target: target,
        mode: .fallback,
        status: agentExplainStatus(explanation.status),
        rules: rules,
        agent: SupatermAgentExplainResult.Agent(
          id: observation.agent.id,
          displayName: observation.agent.displayName,
          phase: agentExplainPhase(observation.phase)
        ),
        process: agentExplainProcess(observation.processIdentity),
        ruleID: observation.ruleID
      )
    }
  }

  private func unresolvedAgentDetectionExplain(
    target: SupatermPaneTarget,
    explanation: TerminalAgentDetectionExplanation
  ) -> SupatermAgentExplainResult {
    let phase = explanation.matchedPhase ?? explanation.publishedPhase
    let agent = phase.flatMap { phase in
      explanation.agent.map { identity in
        SupatermAgentExplainResult.Agent(
          id: identity.id,
          displayName: identity.displayName,
          phase: agentExplainPhase(phase)
        )
      }
    }
    return SupatermAgentExplainResult(
      target: target,
      mode: .none,
      status: explanation.status == .detected
        ? .waiting
        : agentExplainStatus(explanation.status),
      rules: agentExplainRules(explanation),
      agent: agent,
      process: explanation.processIdentity.map(agentExplainProcess),
      ruleID: explanation.matchedRuleID ?? explanation.publishedRuleID
    )
  }

  private func agentExplainRules(
    _ explanation: TerminalAgentDetectionExplanation
  ) -> SupatermAgentExplainResult.Rules? {
    guard let origin = explanation.origin, let generation = explanation.generation else {
      return nil
    }
    let source: SupatermAgentExplainResult.RuleSource =
      switch origin {
      case .embedded: .embedded
      }
    return SupatermAgentExplainResult.Rules(
      source: source,
      generation: generation
    )
  }

  private func agentExplainProcess(
    _ identity: TerminalAgentProcessIdentity
  ) -> SupatermAgentExplainResult.Process {
    SupatermAgentExplainResult.Process(
      processID: identity.processID,
      startTimeMicroseconds: identity.startTimeMicroseconds
    )
  }

  private func agentExplainPhase(
    _ phase: AgentActivityPhase
  ) -> SupatermAgentExplainResult.Phase {
    switch phase {
    case .idle: .idle
    case .running: .running
    case .needsInput: .needsInput
    }
  }

  private func agentExplainStatus(
    _ status: TerminalAgentDetectionExplanation.Status
  ) -> SupatermAgentExplainResult.Status {
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
