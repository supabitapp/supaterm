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

  @Test(arguments: ["[ ! ] Action Required | project", "[ . ] Action Required"])
  func codexActionRequiredTitleNeedsInput(title: String) throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(screen: "", oscTitle: title)
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == "osc_title_blocked")
  }

  @Test
  func codexThreadTitleContainingActionRequiredIsIdle() throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(screen: "", oscTitle: "Action Required follow-up")
    )

    #expect(match.result == .idle)
    #expect(match.ruleID == "osc_title_idle")
  }

  @Test
  func codexNarrowTranscriptViewerHoldsState() throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(
        screen: """
          ↑/↓ to scroll · pgup/pgdn to
          move · home/end to · q to quit
          esc/← to edit prev
          """,
        oscTitle: "project"
      )
    )

    #expect(match.result == .hold)
    #expect(match.ruleID == "transcript_viewer")
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

  @Test
  func codexNewWorkAfterInterruptionIsRunning() throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(
        screen: """
          ■ Conversation interrupted
          › retry
          • Working (2s • esc to interrupt)
          """,
        oscTitle: "project"
      )
    )

    #expect(match.result == .running)
    #expect(match.ruleID == "screen_working_fallback")
  }

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

  @Test(arguments: [
    (
      """
      › Explain why the approval asks “Would you like to continue?” and says Yes
      • Working (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.running,
      "screen_working_fallback"
    ),
    (
      """
      › Explain why this prompt wraps before quoting Continue? [y/N]
        and whether the docs should include it

        gpt-5.6-sol default · /work
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      » Explain why an option can say Yes (y)
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › 1. Document Yes (y)
        2. Document No (n)
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › Explain this footer text
        Press enter to confirm or esc to cancel
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › Explain why status shows (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › Explain this status
        Working (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › What does “to interrupt and send immediately” mean?
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › Explain why this model is no longer available and how to continue
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      › Explain the raw prompt
        Continue? [y/N]:
      """,
      AgentDetectionRuleResult.idle,
      "osc_title_idle"
    ),
    (
      """
      Would you like to run the following command?
      Press enter to confirm or esc to cancel
      • Working (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.running,
      "screen_working_fallback"
    ),
    (
      """
      Question 1/2 (2 unanswered)
      • Working (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.running,
      "screen_working_fallback"
    ),
    (
      """
      Field 1/1 (1 required unanswered)
      • Working (4s • esc to interrupt)
      """,
      AgentDetectionRuleResult.running,
      "screen_working_fallback"
    ),
  ])
  func codexPromptTextDoesNotLookBlocked(
    screen: String,
    result: AgentDetectionRuleResult,
    ruleID: String
  ) throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(screen: screen, oscTitle: "project")
    )

    #expect(match.result == result)
    #expect(match.ruleID == ruleID)
  }

  @Test(arguments: [
    ("Continue? [y/N]: ", "raw_session_confirmation"),
    ("Continue anyway? [y/N]: ", "raw_session_confirmation"),
    (
      """
      Usage limit reached
      Request a limit increase from your owner to continue. Request increase?

        1. Yes (y)
      › 2. No (default) (n)

      Press enter to confirm or esc to go ba
      """,
      "rate_limit_prompt"
    ),
    (
      """
      Approaching rate limits
      Switch to gpt-5.6-luna for lower credit usage?

      › 1. Switch to gpt-5.6-luna
        2. Keep current model

      Press enter to confirm or esc to go ba
      """,
      "rate_limit_prompt"
    ),
    (
      """
      Usage limit resets
      2 resets available.

      › 1. Daily reset
        2. Weekly reset
        3. Cancel
      """,
      "rate_limit_prompt"
    ),
    (
      """
      Use this reset?
      Daily reset · restores usage now

        1. Yes, use reset
      › 2. No, go back
      """,
      "rate_limit_prompt"
    ),
    (
      """
      ✨ Update available! 0.0.0 -> 9.9.9

      › 1. Update now (runs a package install)
        2. Skip

      Press enter to cont
      """,
      "startup_prompt"
    ),
    (
      """
      > Codex just got an upgrade. Introducing a new model.

      › 1. Try new model
        2. Use existing model

      Use ↑/↓ to move, press enter to con
      """,
      "startup_prompt"
    ),
    (
      """
      GPT-5.4 is no longer available

      Switch to the current model to continue.
      """,
      "startup_prompt"
    ),
    (
      """
      GPT-5.4 is no longer available

      Choose how you'd like Codex to proceed.

      › 1. Try new model
        2. Use existing model
      """,
      "startup_prompt"
    ),
    (
      """
      Choose working directory to resume this
      session

      › 1. Use session directory (/tmp/session)
        2. Use current directory (/tmp/current)

      Press enter to cont
      """,
      "startup_prompt"
    ),
    (
      """
      This conversation is
      archived

      › 1. Unarchive and fork
        2. Cancel

      Press enter to continue or esc to can
      """,
      "startup_prompt"
    ),
    (
      """
      Choose an import source

      › 1. Source A
        2. Source B

      Press enter to cont
      """,
      "startup_prompt"
    ),
    (
      """
      > Import setup

      › 1. Import selected
        2. Customize selection
        3. Cancel

      Use ↑/↓ to move, enter to select, c to cus
      """,
      "startup_prompt"
    ),
    (
      """
      Upload logs?

      The following files will be sent:

      › 1. Yes     Share diagnostics
        2. No
      """,
      "feedback_prompt"
    ),
    (
      """
      How was this?

      › 1. bug
        2. bad result
        3. good result
        4. safety check
        5. other
      """,
      "feedback_prompt"
    ),
    (
      """
      ▌ Tell us more (bug)

      ▌ (optional) Write a short description to help us further
      """,
      "feedback_prompt"
    ),
  ])
  func codexStandalonePromptsNeedInput(screen: String, ruleID: String) throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(screen: screen, oscTitle: "project")
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == ruleID)
  }

  @Test(arguments: [
    (
      """
      Would you like to run the foll

      › 1. Yes, proceed (y)
        2. No, and tell Codex what to do differently (esc)

      Press ctrl + x to conf
      """,
      "approval_overlay"
    ),
    (
      """
      Question 1/2 (2 unans
      Choose an option.

      › 1. First
        2. Second

      tab to add notes | ctrl + j to submit answer
      ←/→ to navigate questions | esc to interrupt
      """,
      "request_input"
    ),
    (
      """
      Field 1/1 (1 required unans
      Enter a name

      › Type your answer

      ctrl + x enter to submit
      esc to cancel
      """,
      "mcp_form"
    ),
  ])
  func codexCurrentBlockersNeedInput(screen: String, ruleID: String) throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(
        screen: screen,
        oscTitle: "project"
      )
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == ruleID)
  }

  @Test
  func codexUnansweredConfirmationNeedsInput() throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(
        screen: """
          Submit with unanswered

          2 unanswered questions

          › 1. Proceed
            2. Go back

          Press enter to confirm or esc to go back
          """,
        oscTitle: "project"
      )
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == "unanswered_confirmation")
  }

  @Test(arguments: [
    """
    › 1. Open sign-in URL
      2. Back

    Use tab / ↑ ↓ to move,
    enter to select, esc to close
    """,
    """
    Action required

    › 1. Open link
      2. Back

    Use tab / ↑ ↓ to move, enter to select, esc to close
    """,
    """
    Finish Authentication

    › 1. I already signed in
      2. Back

    Use tab / ↑ ↓ to move, enter to select, esc to close
    """,
  ])
  func codexAppLinkElicitationsNeedInput(screen: String) throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(screen: screen, oscTitle: "project")
    )

    #expect(match.result == .needsInput)
    #expect(match.ruleID == "app_link_blocker")
  }

  @Test
  func codexAppMenuFooterAloneIsIdle() throws {
    let match = try matcher(agentID: "codex").match(
      AgentDetectionInput(
        screen: """
          Apps

          Browse apps

          Use tab / ↑ ↓ to move, enter to select, esc to close
          """,
        oscTitle: "project"
      )
    )

    #expect(match.result == .idle)
    #expect(match.ruleID == "osc_title_idle")
  }

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
