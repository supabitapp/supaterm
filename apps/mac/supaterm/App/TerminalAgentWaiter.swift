import Foundation
import SupatermCLIShared
import SupatermTerminalCore

@MainActor
enum TerminalAgentWaiter {
  static func wait<C: Clock>(
    _ request: SupatermAgentWaitRequest,
    clock: C,
    sample: (SupatermAgentIdentity?) throws -> TerminalAgentControlSample
  ) async throws -> SupatermAgentWaitResult where C.Duration == Duration {
    try request.validate()
    let deadline = clock.now.advanced(by: .seconds(request.timeoutSeconds))
    var identity = request.expectedAgent.flatMap { expected in
      expected.process.map { SupatermAgentIdentity(kind: expected.kind, process: $0) }
    }

    func result(_ outcome: SupatermAgentWaitResult.Outcome) -> SupatermAgentWaitResult {
      SupatermAgentWaitResult(
        paneID: request.target.paneID,
        outcome: outcome,
        matched: outcome.matches(request.until),
        identity: identity
      )
    }

    while true {
      try Task.checkCancellation()
      let current: TerminalAgentControlSample
      do {
        current = try sample(identity)
      } catch TerminalControlError.contextPaneNotFound where identity != nil {
        return result(.exited)
      }
      if let agent = current.identity {
        if let identity, identity != agent { return result(.replaced) }
        if let expected = request.expectedAgent, !expected.matches(agent) { return result(.replaced) }
        identity = agent
        if let phase = current.phase,
          let outcome = SupatermAgentWaitResult.Outcome(phase: phase),
          outcome.matches(request.until)
        {
          return result(outcome)
        }
      } else if identity != nil, !current.expectedProcessIsAlive {
        return result(.exited)
      }
      if clock.now >= deadline {
        let uncertain = identity != nil && (current.phase == nil || current.phase == .unknown)
        return result(uncertain ? .unknown : .timeout)
      }
      try await clock.sleep(until: min(deadline, clock.now.advanced(by: .milliseconds(100))), tolerance: nil)
    }
  }
}

extension TerminalCommandExecutor {
  func waitAgent(_ request: SupatermAgentWaitRequest) async throws -> SupatermAgentWaitResult {
    try await TerminalAgentWaiter.wait(request, clock: ContinuousClock()) { expected in
      try executeTargeted(
        operation: { try $0.terminal.agentControlSample(for: request.target.paneID, expected: expected) },
        rewrite: { result, _ in result }
      )
    }
  }
}
