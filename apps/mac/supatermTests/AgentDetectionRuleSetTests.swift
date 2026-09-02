import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionRuleSetTests {
  @Test
  func bundledManifestsUseTheSupportedProcessForms() throws {
    let agents = try AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents
    let definitions = TerminalCodingAgentCatalog.activityAgents

    #expect(agents.map(\.id) == definitions.map(\.id))
    #expect(agents.map(\.displayName) == definitions.compactMap(\.activityDisplayName))
    #expect(agents.map(\.processes) == definitions.map(\.processes))
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
