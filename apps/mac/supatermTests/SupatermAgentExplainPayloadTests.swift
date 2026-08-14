import Foundation
import SupatermCLIShared
import Testing

struct SupatermAgentExplainPayloadTests {
  @Test
  func resultRoundTripsWithCamelCaseFieldsAndStableEnumValues() throws {
    let result = agentExplainTestResult()
    let data = try JSONEncoder().encode(result)
    let object = try #require(
      JSONSerialization.jsonObject(with: data) as? [String: Any]
    )
    let rules = try #require(object["rules"] as? [String: Any])
    let agent = try #require(object["agent"] as? [String: Any])
    let process = try #require(object["process"] as? [String: Any])

    #expect(object["mode"] as? String == "fallback")
    #expect(object["status"] as? String == "no_rule_match_or_settling")
    #expect(object["ruleID"] as? String == "claude.needs-input")
    #expect(rules["source"] as? String == "embedded")
    #expect((rules["generation"] as? NSNumber)?.uint64Value == 7)
    #expect(agent["displayName"] as? String == "Claude")
    #expect(agent["phase"] as? String == "needs_input")
    #expect((process["processID"] as? NSNumber)?.int32Value == 42)
    #expect((process["startTimeMicroseconds"] as? NSNumber)?.uint64Value == 123)
    #expect(try JSONDecoder().decode(SupatermAgentExplainResult.self, from: data) == result)
  }

  @Test
  func requestFactoryUsesPaneTargetAndAgentExplainMethod() throws {
    let paneID = agentExplainPaneID
    let request = try SupatermSocketRequest.agentExplain(
      SupatermPaneTargetRequest(paneID: paneID),
      id: "explain-1"
    )

    #expect(request.id == "explain-1")
    #expect(request.method == "terminal.agent_explain")
    #expect(
      try request.decodeParams(SupatermPaneTargetRequest.self)
        == SupatermPaneTargetRequest(paneID: paneID)
    )
  }

  @Test
  func everyModeStatusPhaseAndRuleSourceDecodesFromItsWireValue() throws {
    for value in ["native", "fallback", "none"] {
      #expect(
        try JSONDecoder().decode(
          SupatermAgentExplainResult.Mode.self,
          from: Data("\"\(value)\"".utf8)
        ).rawValue == value
      )
    }
    for value in [
      "detection_disabled",
      "waiting",
      "no_foreground_process",
      "unrecognized_process",
      "native_authority",
      "screen_unavailable",
      "no_rule_match_or_settling",
      "resolved",
    ] {
      #expect(
        try JSONDecoder().decode(
          SupatermAgentExplainResult.Status.self,
          from: Data("\"\(value)\"".utf8)
        ).rawValue == value
      )
    }
    for value in ["idle", "running", "needs_input"] {
      #expect(
        try JSONDecoder().decode(
          SupatermAgentExplainResult.Phase.self,
          from: Data("\"\(value)\"".utf8)
        ).rawValue == value
      )
    }
    for value in ["embedded"] {
      #expect(
        try JSONDecoder().decode(
          SupatermAgentExplainResult.RuleSource.self,
          from: Data("\"\(value)\"".utf8)
        ).rawValue == value
      )
    }
  }
}

let agentExplainPaneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!

func agentExplainTestTarget() -> SupatermPaneTarget {
  SupatermPaneTarget(
    windowIndex: 1,
    spaceIndex: 1,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 1,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 1,
    paneID: agentExplainPaneID
  )
}

func agentExplainTestResult() -> SupatermAgentExplainResult {
  SupatermAgentExplainResult(
    target: agentExplainTestTarget(),
    mode: .fallback,
    status: .noRuleMatchOrSettling,
    rules: SupatermAgentExplainResult.Rules(source: .embedded, generation: 7),
    agent: SupatermAgentExplainResult.Agent(
      id: "claude",
      displayName: "Claude",
      phase: .needsInput
    ),
    process: SupatermAgentExplainResult.Process(
      processID: 42,
      startTimeMicroseconds: 123
    ),
    ruleID: "claude.needs-input"
  )
}
