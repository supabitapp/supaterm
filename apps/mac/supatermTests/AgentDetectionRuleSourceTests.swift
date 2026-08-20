import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionRuleSourceTests {
  @Test
  func repositoryLoadsOnlyTheBundledManifests() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let snapshot = await repository.snapshot()

    #expect(snapshot.origin == .embedded)
    #expect(snapshot.generation > 0)
    #expect(snapshot.processManifests.map(\.agentID) == ["claude", "codex", "pi"])
  }

  @Test
  func knownAgentWithoutMatchingEvidenceFallsBackToIdle() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluate([
      AgentDetectionEvaluationRequest(
        agentID: "pi",
        input: AgentDetectionInput(screen: "", oscTitle: "")
      )
    ])
    let evaluation = try #require(evaluations[0])

    #expect(evaluation.identity == AgentDetectionAgentIdentity(id: "pi", displayName: "Pi"))
    #expect(evaluation.match.result == .idle)
    #expect(evaluation.match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }

  @Test
  func signalEvaluationStopsBeforeScreenCaptureWhenDecisive() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluateSignals([
      AgentDetectionSignalRequest(
        agentID: "codex",
        input: AgentDetectionSignalInput(oscTitle: "⠋ project")
      ),
      AgentDetectionSignalRequest(
        agentID: "pi",
        input: AgentDetectionSignalInput(oscTitle: "")
      ),
    ])

    let codex = try #require(evaluations[0])
    let pi = try #require(evaluations[1])
    guard case .matched(let codexEvaluation) = codex else {
      Issue.record("Expected a decisive signal match.")
      return
    }
    guard case .needsScreen = pi else {
      Issue.record("Expected screen evaluation.")
      return
    }

    #expect(codexEvaluation.match.ruleID == "osc_title_working")
    #expect(codexEvaluation.match.result == .running)
  }

  @Test
  func unknownAgentCannotSelectRules() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluate([
      AgentDetectionEvaluationRequest(
        agentID: "unknown",
        input: AgentDetectionInput(screen: "Working...", oscTitle: "")
      )
    ])

    #expect(evaluations == [nil])
  }
}
