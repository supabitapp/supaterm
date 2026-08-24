import Testing

@testable import SupatermSupport

struct AgentDetectionSettlerTests {
  @Test
  func holdWithoutPriorStateStaysUnknown() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    #expect(settler.settle(match: match(.hold), processToken: "one", now: now) == .unknown)
  }

  @Test(arguments: [AgentDetectionRuleResult.running, .needsInput])
  func strongStatesPublishImmediately(result: AgentDetectionRuleResult) {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    #expect(
      settler.settle(match: match(result), processToken: "one", now: now)
        == strongState(for: result)
    )
  }

  @Test
  func unknownPublishesImmediately() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    _ = settler.settle(match: match(.running), processToken: "one", now: now)
    #expect(settler.settle(match: match(.unknown), processToken: "one", now: now) == .unknown)
  }

  @Test
  func plainIdleNeedsThreeConfirmationsAfterRunning() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    #expect(settler.settle(match: match(.running), processToken: "one", now: now) == .running)
    #expect(!settler.isConfirmingIdle)
    for _ in 0..<3 {
      #expect(settler.settle(match: match(.idle), processToken: "one", now: now) == .running)
      #expect(settler.isConfirmingIdle)
    }
    #expect(settler.settle(match: match(.idle), processToken: "one", now: now) == .idle)
    #expect(!settler.isConfirmingIdle)
  }

  @Test
  func plainIdlePublishesAtThe700MillisecondCap() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    _ = settler.settle(match: match(.running), processToken: "one", now: now)
    #expect(settler.settle(match: match(.idle), processToken: "one", now: now) == .running)
    #expect(
      settler.settle(
        match: match(.idle),
        processToken: "one",
        now: now.advanced(by: .milliseconds(700))
      ) == .idle
    )
  }

  @Test
  func visibleIdleBypassesTheWorkingToIdleDelay() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    _ = settler.settle(match: match(.running), processToken: "one", now: now)
    #expect(
      settler.settle(
        match: match(.idle, visibleIdle: true),
        processToken: "one",
        now: now
      ) == .idle
    )
  }

  @Test
  func needsInputToIdlePublishesImmediately() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    _ = settler.settle(match: match(.needsInput), processToken: "one", now: now)
    #expect(settler.settle(match: match(.idle), processToken: "one", now: now) == .idle)
  }

  @Test
  func holdPreservesStateAndClearsPendingIdle() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    _ = settler.settle(match: match(.running), processToken: "one", now: now)
    _ = settler.settle(match: match(.idle), processToken: "one", now: now)
    _ = settler.settle(match: match(.idle), processToken: "one", now: now)
    #expect(settler.settle(match: match(.hold), processToken: "one", now: now) == .running)
    for _ in 0..<3 {
      #expect(settler.settle(match: match(.idle), processToken: "one", now: now) == .running)
    }
  }

  @Test
  func processTokenChangeResetsBeforeApplyingHold() {
    let now = ContinuousClock().now
    var settler = AgentDetectionSettler<String>()

    #expect(settler.settle(match: match(.running), processToken: "one", now: now) == .running)
    #expect(settler.settle(match: match(.hold), processToken: "two", now: now) == .unknown)
  }

  private func match(
    _ result: AgentDetectionRuleResult,
    visibleIdle: Bool = false
  ) -> AgentDetectionMatch {
    AgentDetectionMatch(
      result: result,
      ruleID: "rule",
      visibleIdle: visibleIdle
    )
  }

  private func strongState(for result: AgentDetectionRuleResult) -> AgentDetectionState {
    switch result {
    case .running:
      .running
    case .needsInput:
      .needsInput
    case .unknown, .idle, .hold:
      fatalError("Strong evidence requires a running or needs-input result")
    }
  }
}
