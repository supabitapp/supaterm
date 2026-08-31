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
}
