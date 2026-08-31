import Testing

@testable import SupatermSupport
@testable import supaterm

extension AgentDetectionMatcherTests {
  @Test
  func piTranscriptWorkingLiteralIsUnknown() throws {
    let match = try matcher(agentID: "pi").match(
      AgentDetectionInput(
        screen: "The response says Working... but Pi is waiting.\n\n> ",
        oscTitle: "project"
      )
    )

    #expect(match.result == .unknown)
    #expect(match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }

  @Test
  func piWorkingStatusWithoutAnIndicatorIsRunning() throws {
    let match = try matcher(agentID: "pi").match(
      AgentDetectionInput(
        screen: "Working...\n\n> \n~/code/project\nmodel · 42%",
        oscTitle: "project"
      )
    )

    #expect(match.result == .running)
    #expect(match.ruleID == "working_status")
  }

  @Test(arguments: ["● Working...", "◆ Working..."])
  func piCustomIndicatorsAreRunning(status: String) throws {
    let match = try matcher(agentID: "pi").match(
      AgentDetectionInput(
        screen: "\(status)\n\n> \n~/code/project\nmodel · 42%",
        oscTitle: "project"
      )
    )

    #expect(match.result == .running)
    #expect(match.ruleID == "working_status")
  }

  @Test
  func piCustomWorkingMessageIsUnknown() throws {
    let match = try matcher(agentID: "pi").match(
      AgentDetectionInput(
        screen: "◆ Indexing files…\n\n> \n~/code/project\nmodel · 42%",
        oscTitle: "project"
      )
    )

    #expect(match.result == .unknown)
    #expect(match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }
}
