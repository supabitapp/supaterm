import Testing

@testable import SupatermSupport
@testable import supaterm

extension AgentDetectionMatcherTests {
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
    #expect(!match.visibleIdle)
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
      Question 2/2 (2 unanswered)
      Share details.

      › Type your answer (optional)
      enter to submit all | ctrl + p / ctrl + n change question | esc to interrupt
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
}
