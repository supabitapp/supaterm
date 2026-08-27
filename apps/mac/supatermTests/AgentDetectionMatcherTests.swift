import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionMatcherTests {
  @Test
  func selectsTheHighestPriorityMatchAndKeepsFileOrderForTies() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(
        rules: [
          rule(id: "first", result: .idle, priority: 20, contains: ["ready"]),
          rule(id: "second", result: .needsInput, priority: 20, contains: ["ready"]),
          rule(id: "low", result: .running, priority: 10, contains: ["ready"]),
        ]
      )
    )

    #expect(
      matcher.match(AgentDetectionInput(screen: "ready", oscTitle: ""))
        == AgentDetectionMatch(result: .idle, ruleID: "first")
    )
  }

  @Test
  func signalMatchStopsBeforeLowerPriorityScreenRules() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(
        rules: [
          rule(
            id: "title",
            priority: 30,
            region: .oscTitle,
            contains: ["working"]
          ),
          rule(id: "screen", priority: 20, contains: ["blocked"]),
        ]
      )
    )

    #expect(
      matcher.matchSignals(AgentDetectionSignalInput(oscTitle: "Working"))
        == .matched(AgentDetectionMatch(result: .running, ruleID: "title"))
    )
  }

  @Test
  func signalMatchDefersToHigherPriorityScreenRules() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(
        rules: [
          rule(id: "screen", result: .needsInput, priority: 30, contains: ["blocked"]),
          rule(
            id: "title",
            priority: 20,
            region: .oscTitle,
            contains: ["working"]
          ),
        ]
      )
    )

    #expect(
      matcher.matchSignals(AgentDetectionSignalInput(oscTitle: "Working")) == .needsScreen
    )
    #expect(
      matcher.match(
        AgentDetectionInput(screen: "Blocked", oscTitle: "Working")
      ) == AgentDetectionMatch(result: .needsInput, ruleID: "screen")
    )
  }

  @Test
  func noMatchingRuleUsesTheKnownAgentUnknownFallback() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(rules: [rule(contains: ["ready"])])
    )

    #expect(
      matcher.match(AgentDetectionInput(screen: "working", oscTitle: ""))
        == AgentDetectionMatch(
          result: .unknown,
          ruleID: AgentDetectionMatcher.fallbackRuleID
        )
    )
  }

  @Test
  func evaluatesRecursiveManifestGates() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(
        rules: [
          rule(
            gate: AgentDetectionGate(
              contains: ["ready"],
              regex: [#"Press\s+Enter"#],
              lineRegex: [#"^Press Enter$"#],
              all: [AgentDetectionGate(contains: ["enter"])],
              any: [
                AgentDetectionGate(contains: ["return"]),
                AgentDetectionGate(contains: ["press"]),
              ],
              not: [AgentDetectionGate(contains: ["denied"])]
            )
          )
        ]
      )
    )

    #expect(
      matcher.match(AgentDetectionInput(screen: "READY\nPress Enter", oscTitle: "")).ruleID
        == "rule"
    )
    #expect(
      matcher.match(
        AgentDetectionInput(screen: "READY\nPress Enter\nDenied", oscTitle: "")
      ).ruleID == AgentDetectionMatcher.fallbackRuleID
    )
  }

  @Test
  func extractsEveryUsedRegion() throws {
    let rules = [
      rule(id: "bottom", priority: 10, region: .bottomNonEmptyLines(2), contains: ["b\n\nc"]),
      rule(id: "top", priority: 20, region: .topNonEmptyLines(2), contains: ["a\n\nb"]),
      rule(id: "prompt", priority: 30, region: .afterLastPromptMarker, contains: ["after"]),
      rule(id: "box", priority: 40, region: .promptBoxBody, contains: ["inside"]),
      rule(
        id: "above-box",
        priority: 45,
        region: .lastNonEmptyAbovePromptBox,
        contains: ["inside"]
      ),
      rule(id: "rule", priority: 50, region: .afterLastHorizontalRule, contains: ["below"]),
      rule(id: "title", priority: 60, region: .oscTitle, contains: ["title"]),
      rule(id: "progress", priority: 70, region: .oscProgress, contains: ["4;0"]),
    ]
    let matcher = try AgentDetectionMatcher(agent: agent(rules: rules))

    #expect(
      matcher.match(
        AgentDetectionInput(
          screen: "a\n\nb\n› prompt\nafter\n───\ninside\n───\nbelow\n\nc",
          oscTitle: "title",
          oscProgress: "4;0;"
        )
      ).ruleID == "progress"
    )
  }

  @Test
  func lastNonEmptyAbovePromptBoxExcludesThePromptBody() throws {
    let matcher = try AgentDetectionMatcher(
      agent: agent(
        rules: [
          rule(
            region: .lastNonEmptyAbovePromptBox,
            contains: ["Waiting for 2 background agents to finish"]
          )
        ]
      )
    )

    #expect(
      matcher.match(
        AgentDetectionInput(
          screen: """
            Waiting for 2 background agents to finish

            ───
            ❯ prompt
            ───
            footer
            """,
          oscTitle: ""
        )
      ).ruleID == "rule"
    )
    #expect(
      matcher.match(
        AgentDetectionInput(
          screen: """
            idle
            ───
            Waiting for 2 background agents to finish
            ───
            footer
            """,
          oscTitle: ""
        )
      ).ruleID == AgentDetectionMatcher.fallbackRuleID
    )
  }

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

  @Test
  func codexInterruptionClearsStaleScreenWorkingState() throws {
    let codex = try matcher(agentID: "codex")
    let match = codex.match(
      AgentDetectionInput(
        screen: """
          • Working (8m 21s • esc to interrupt)
          ■ Conversation interrupted - tell the model what to do differently.
          › do it in a new worktree
          """,
        oscTitle: "project"
      )
    )

    #expect(match.result == .idle)
    #expect(match.ruleID == "osc_title_idle")
  }

  @Test(arguments: [
    "claude-legacy-blocker", "claude-needs-input", "codex-needs-input", "codex-trust",
  ])
  func permissionFixturesNeedInput(name: String) throws {
    #expect(try matchFixture(name).result == .needsInput)
  }

  @Test(arguments: [
    "claude-background-agents", "claude-background-mcp-task", "claude-background-shell",
    "claude-live-turn", "claude-running",
    "codex-running", "codex-working-spinner", "codex-working-clipped",
    "codex-working-reasoning-header", "codex-working-queued", "codex-working-steers-only",
    "codex-working-reconnecting", "codex-working-reconnecting-narrow",
    "codex-working-remapped-plain", "pi-running",
  ])
  func workingFixturesAreRunning(name: String) throws {
    #expect(try matchFixture(name).result == .running)
  }

  @Test(arguments: ["claude-idle", "codex-idle"])
  func idleFixturesAreIdle(name: String) throws {
    #expect(try matchFixture(name).result == .idle)
  }

  @Test(arguments: ["pi-idle"])
  func unmatchedFixturesAreUnknown(name: String) throws {
    #expect(try matchFixture(name).result == .unknown)
  }

  @Test(arguments: ["claude-model-picker", "claude-transcript", "codex-transcript"])
  func ambiguousScreenFixturesHoldThePriorState(name: String) throws {
    #expect(try matchFixture(name).result == .hold)
  }

  @Test(arguments: [
    ("claude-idle", "live_prompt_box"),
    ("claude-background-agents", "background_agents_working"),
    ("claude-background-mcp-task", "background_mcp_task_working"),
    ("claude-background-shell", "background_shell_working"),
    ("claude-legacy-blocker", "legacy_no_prompt_blocker"),
    ("claude-live-turn", "live_turn_working"),
    ("claude-model-picker", "model_picker_menu"),
    ("claude-needs-input", "live_blocked_form"),
    ("claude-running", "osc_title_working"),
    ("claude-transcript", "transcript_viewer"),
    ("codex-idle", "osc_title_idle"),
    ("codex-needs-input", "live_strong_blocker"),
    ("codex-running", "screen_working_fallback"),
    ("codex-transcript", "transcript_viewer"),
    ("codex-trust", "trust_directory"),
    ("codex-working-spinner", "osc_title_working"),
    ("codex-working-clipped", "screen_working_fallback"),
    ("codex-working-reasoning-header", "screen_working_fallback"),
    ("codex-working-queued", "screen_working_fallback"),
    ("codex-working-steers-only", "queued_messages_working"),
    ("codex-working-reconnecting", "screen_working_fallback"),
    ("codex-working-reconnecting-narrow", "screen_working_fallback"),
    ("codex-working-remapped-plain", "screen_working_fallback"),
    ("pi-idle", "default_known_agent_unknown_fallback"),
    ("pi-running", "working_literal"),
  ])
  func fixturesMatchTheirOwningRule(name: String, ruleID: String) throws {
    #expect(try matchFixture(name).ruleID == ruleID)
  }

  private func agent(rules: [AgentDetectionStateRule]) -> AgentDetectionAgentRule {
    AgentDetectionAgentRule(
      id: "agent",
      displayName: "Agent",
      version: nil,
      source: AgentDetectionManifestSource(origin: .bundled, path: "agent.toml"),
      processes: [AgentDetectionProcessRule(executable: "agent")],
      rules: rules
    )
  }

  private func rule(
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

  private func matcher(agentID: String) throws -> AgentDetectionMatcher {
    let agent = try #require(
      AgentDetectionRuleSetParser.load(from: SupatermResources.bundle).agents.first {
        $0.id == agentID
      }
    )
    return try AgentDetectionMatcher(agent: agent)
  }

  private func matchFixture(_ name: String) throws -> AgentDetectionMatch {
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
