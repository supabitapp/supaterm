import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionRuleSetTests {
  @Test
  func bundledManifestsUseTheSupportedProcessForms() throws {
    let agents = try AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents

    #expect(
      agents[0].processes == [
        AgentDetectionProcessRule(executable: "claude"),
        AgentDetectionProcessRule(executable: "claude.exe"),
      ]
    )
    #expect(
      agents[1].processes == [
        AgentDetectionProcessRule(executable: "codex"),
        AgentDetectionProcessRule(executable: "codex-aarch64-apple-darwin"),
        AgentDetectionProcessRule(executable: "codex-x86_64-apple-darwin"),
      ]
    )
    #expect(
      agents[2].processes == [
        AgentDetectionProcessRule(executable: "pi"),
        AgentDetectionProcessRule(executable: "node", processTitle: "pi"),
      ]
    )
  }

  @Test
  func everyBundledRegularExpressionCompiles() throws {
    for agent in try AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents {
      _ = try AgentDetectionMatcher(agent: agent)
    }
  }

  @Test
  func parserRejectsUnknownManifestKeys() {
    #expect(throws: AgentDetectionRuleSetError.self) {
      try AgentDetectionRuleSetParser.parse(Data("id = 'pi'\nunknown = true\n".utf8))
    }
  }

  @Test
  func parserPublishesExplicitUnknownRules() throws {
    let manifest = try AgentDetectionRuleSetParser.parse(
      Data(
        """
        id = "pi"

        [[rules]]
        id = "ambiguous"
        state = "unknown"
        contains = ["ambiguous"]
        """.utf8
      )
    )

    #expect(manifest.rules.first?.result == .unknown)
  }
}
