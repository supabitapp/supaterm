import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

extension AgentDetectionMatcherTests {
  func agent(rules: [AgentDetectionStateRule]) -> AgentDetectionAgentRule {
    AgentDetectionAgentRule(
      id: "agent",
      displayName: "Agent",
      version: nil,
      source: AgentDetectionManifestSource(origin: .bundled, path: "agent.toml"),
      processes: [AgentDetectionProcessRule(executable: "agent")],
      rules: rules
    )
  }

  func rule(
    id: String = "rule",
    result: AgentDetectionRuleResult = .running,
    priority: Int = 0,
    region: AgentDetectionRegion = .wholeRecent,
    contains: [String] = [],
    gate: AgentDetectionGate? = nil
  ) -> AgentDetectionStateRule {
    AgentDetectionStateRule(
      id: id,
      result: result,
      priority: priority,
      region: region,
      gate: gate ?? AgentDetectionGate(contains: contains)
    )
  }

  func matcher(agentID: String) throws -> AgentDetectionMatcher {
    let agent = try #require(
      AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents.first {
        $0.id == agentID
      }
    )
    return try AgentDetectionMatcher(agent: agent)
  }

  func matchFixture(_ name: String) throws -> AgentDetectionMatch {
    let fixtureURL = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("Fixtures/AgentDetection/\(name).txt")
    let contents = try String(contentsOf: fixtureURL, encoding: .utf8)
    let lines = contents.split(separator: "\n", omittingEmptySubsequences: false)
    let title = lines.first.map(String.init) ?? ""
    let screen = lines.dropFirst(2).joined(separator: "\n")
    let agentID = String(name.prefix { $0 != "-" })
    return try matcher(agentID: agentID).match(
      AgentDetectionInput(screen: screen, oscTitle: title)
    )
  }
}
