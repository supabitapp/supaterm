import Testing

@testable import SupatermSupport
@testable import supaterm

extension AgentDetectionMatcherTests {
  @Test(arguments: [
    """
    MCP server “my-server” requests your input

    Grant temporary access?

    ❯ Accept    Decline

    Esc to
    cancel · ↑/↓ to navigate
    """,
    """
    MCP server "my-server"
      requests your input (task task-42)

    Server-supplied message

    Accept    ❯ Decline

    Esc to cancel · ↑/↓ to navigate
    """,
  ])
  func claudeMcpElicitationNeedsInput(screen: String) throws {
    let match = try matcher(agentID: "claude").match(
      AgentDetectionInput(screen: screen, oscTitle: "✳ project")
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == "mcp_elicitation_prompt")
  }

  @Test(arguments: [
    (
      """
      ✻ Waiting for API response · will retry in 5s · check your network
      """,
      "live_turn_working"
    ),
    (
      """
      · Waiting for 2 background agents and 1 dynamic workflow to finish

      ───
      ❯ prompt
      ───
      footer
      """,
      "background_agents_working"
    ),
    (
      """
      · Waiting for 1 dynamic workflow to finish

      ───
      ❯ prompt
      ───
      footer
      """,
      "background_agents_working"
    ),
    (
      """
      · Waiting for 2 background agents and 1 dynamic
        workflow to finish

      ───
      ❯ prompt
      ───
      footer
      """,
      "background_agents_working"
    ),
    (
      """
      ✻ Running a task
        Checking the project · dreaming still running
      """,
      "background_tasks_working"
    ),
    (
      """
      ✻ Running a task
        Checking the project · 2 MCP
        tasks still running
      """,
      "background_tasks_working"
    ),
    (
      """
      ✻ Running a task
        Checking the project · 1 background dynamic workflow still running
      """,
      "background_tasks_working"
    ),
  ])
  func claudeCurrentScreenFallbacksAreRunning(screen: String, ruleID: String) throws {
    let match = try matcher(agentID: "claude").match(
      AgentDetectionInput(screen: screen, oscTitle: "✳ project")
    )

    #expect(match.result == .running)
    #expect(match.ruleID == ruleID)
  }

  @Test
  func claudeUltraplanAttentionNeedsInput() throws {
    let match = try matcher(agentID: "claude").match(
      AgentDetectionInput(
        screen: """
          ✻ Running a task
            Checking the project · ◇ ultraplan needs your input still running
          """,
        oscTitle: "✳ project"
      )
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == "ultraplan_needs_input")
  }

  @Test
  func claudeStaticMuxTitleWithoutScreenEvidenceIsUnknown() throws {
    let match = try matcher(agentID: "claude").match(
      AgentDetectionInput(screen: "", oscTitle: "✳ project")
    )

    #expect(match.result == .unknown)
    #expect(match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }

  @Test(arguments: [
    "✻ The prior answer says foo · bar is still running",
    "✻ The docs say Waiting for API response, will retry in 5s, then check your network",
    "❯ Waiting for API response · will retry in 5s · check your network",
  ])
  func claudeProseAboutWorkingStatesIsIdle(prose: String) throws {
    let match = try matcher(agentID: "claude").match(
      AgentDetectionInput(
        screen: """
          \(prose)

          ───
          ❯
          ───
          """,
        oscTitle: "✳ project"
      )
    )

    #expect(match.result == .idle)
    #expect(match.ruleID == "live_prompt_box")
  }
}
