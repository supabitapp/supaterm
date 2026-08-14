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
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)

    #expect(
      await repository.evaluate(
        agentID: "unknown",
        input: AgentDetectionInput(screen: "Working...", oscTitle: "")
      ) == nil
    )
  }
}
