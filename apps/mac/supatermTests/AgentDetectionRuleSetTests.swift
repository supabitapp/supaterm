import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionRuleSetTests {
  @Test
  func bundledManifestsContainTheExactRuleOrder() throws {
    let agents = try AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents

    #expect(agents.map(\.id) == ["claude", "codex", "pi"])
    #expect(
      agents[0].rules.map(\.id) == [
        "osc_title_working",
        "btw_overlay_working",
        "transcript_viewer",
        "live_blocked_form",
        "dynamic_workflow_prompt",
        "live_prompt_box",
        "model_picker_menu",
        "bash_permission_prompt",
        "generic_permission_prompt",
        "legacy_no_prompt_blocker",
        "osc_title_idle",
        "osc_progress_idle",
      ]
    )
    #expect(
      agents[1].rules.map(\.id) == [
        "osc_title_blocked",
        "osc_title_working",
        "transcript_viewer",
        "trust_directory",
        "live_strong_blocker",
        "weak_blocker",
        "screen_working_fallback",
        "queued_messages_working",
        "osc_title_idle",
      ]
    )
    #expect(agents[2].rules.map(\.id) == ["working_literal"])
  }

  @Test
  func bundledManifestsUseTheSupportedProcessForms() throws {
    let agents = try AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents

    #expect(
      agents[0].processes == [
        AgentDetectionProcessRule(executable: "claude"),
        AgentDetectionProcessRule(
          executable: "node",
          scriptSuffix: "/@anthropic-ai/claude-code/cli.js"
        ),
      ]
    )
    #expect(
      agents[1].processes == [
        AgentDetectionProcessRule(executable: "codex"),
        AgentDetectionProcessRule(
          executable: "node",
          scriptSuffix: "/@openai/codex/bin/codex.js"
        ),
      ]
    )
    #expect(
      agents[2].processes == [
        AgentDetectionProcessRule(executable: "pi"),
        AgentDetectionProcessRule(executable: "node", processTitle: "pi"),
        AgentDetectionProcessRule(
          executable: "node",
          scriptSuffix: "/@mariozechner/pi-coding-agent/dist/cli.js"
        ),
        AgentDetectionProcessRule(
          executable: "node",
          scriptSuffix: "/@earendil-works/pi-coding-agent/dist/cli.js"
        ),
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
}
