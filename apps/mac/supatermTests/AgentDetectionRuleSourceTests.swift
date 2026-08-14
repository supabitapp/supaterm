import Testing

@testable import SupatermSupport

struct AgentDetectionRuleSourceTests {
  @Test
  func repositoryUsesOnlyTheEmbeddedCatalog() async throws {
    let repository = try AgentDetectionRuleRepository()
    let snapshot = await repository.snapshot()

    #expect(snapshot.origin == .embedded)
    #expect(snapshot.generation == AgentDetectionRules.generation)
    #expect(snapshot.processManifests.map(\.agentID) == ["claude", "codex", "pi"])
  }

  @Test
  func knownAgentWithoutMatchingEvidenceFallsBackToIdle() async throws {
    let repository = try AgentDetectionRuleRepository()
    let evaluation = try #require(
      await repository.evaluate(
        agentID: "pi",
        input: AgentDetectionInput(screen: "", oscTitle: "")
      )
    )

    #expect(evaluation.identity == AgentDetectionAgentIdentity(id: "pi", displayName: "Pi"))
    #expect(evaluation.match.result == .idle)
    #expect(evaluation.match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }

  @Test
  func unknownAgentCannotSelectRules() async throws {
    let repository = try AgentDetectionRuleRepository()

    #expect(
      await repository.evaluate(
        agentID: "unknown",
        input: AgentDetectionInput(screen: "Working...", oscTitle: "")
      ) == nil
    )
  }
}
