import Testing

@testable import SupatermSupport
@testable import supaterm

extension AgentDetectionMatcherTests {
  @Test
  func currentCatalogDetectsTrustPromptAndNewSpinner() throws {
    let claude = try matcher(agentID: "claude")
    let codex = try matcher(agentID: "codex")

    #expect(
      claude.match(AgentDetectionInput(screen: "", oscTitle: "◐ project")).result == .running
    )
    #expect(
      codex.match(
        AgentDetectionInput(
          screen: "> You are in /tmp/project\n\nDo you trust the contents of this directory?",
          oscTitle: ""
        )
      ).ruleID == "trust_directory"
    )
    #expect(
      claude.match(
        AgentDetectionInput(screen: "", oscTitle: "", oscProgress: "4;0")
      ).ruleID == "osc_progress_idle"
    )
  }

  @Test(arguments: [
    ("claude-idle", AgentDetectionRuleResult.idle, "live_prompt_box"),
    ("claude-background-agents", .running, "background_agents_working"),
    ("claude-background-mcp-task", .running, "background_tasks_working"),
    ("claude-background-shell", .running, "background_shell_working"),
    ("claude-legacy-blocker", .needsInput, "legacy_no_prompt_blocker"),
    ("claude-live-turn", .running, "live_turn_working"),
    ("claude-model-picker", .hold, "model_picker_menu"),
    ("claude-needs-input", .needsInput, "live_blocked_form"),
    ("claude-running", .running, "osc_title_working"),
    ("claude-transcript", .hold, "transcript_viewer"),
    ("codex-idle", .idle, "osc_title_idle"),
    ("codex-needs-input", .needsInput, "approval_overlay"),
    ("codex-running", .running, "screen_working_fallback"),
    ("codex-transcript", .hold, "transcript_viewer"),
    ("codex-trust", .needsInput, "trust_directory"),
    ("codex-working-spinner", .running, "osc_title_working"),
    ("codex-working-clipped", .running, "screen_working_fallback"),
    ("codex-working-reasoning-header", .running, "screen_working_fallback"),
    ("codex-working-queued", .running, "screen_working_fallback"),
    ("codex-working-steers-only", .running, "queued_messages_working"),
    ("codex-working-reconnecting", .running, "screen_working_fallback"),
    ("codex-working-reconnecting-narrow", .running, "screen_working_fallback"),
    ("codex-working-remapped-plain", .running, "screen_working_fallback"),
    ("pi-idle", .unknown, "default_known_agent_unknown_fallback"),
    ("pi-running", .running, "working_status"),
  ])
  func fixturesMatchTheirExpectedResultAndOwningRule(
    name: String,
    result: AgentDetectionRuleResult,
    ruleID: String
  ) throws {
    let match = try matchFixture(name)

    #expect(match.result == result)
    #expect(match.ruleID == ruleID)
  }
}
