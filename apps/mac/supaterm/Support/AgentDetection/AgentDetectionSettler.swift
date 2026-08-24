public enum AgentDetectionState: Equatable, Sendable {
  case unknown
  case running
  case needsInput
  case idle
}

public struct AgentDetectionSettler<ProcessToken: Hashable & Sendable>: Sendable {
  private var processToken: ProcessToken?
  private var state = AgentDetectionState.unknown
  private var pendingIdle: PendingIdle?

  public init() {}

  public var isConfirmingIdle: Bool {
    pendingIdle != nil
  }

  public mutating func settle(
    match: AgentDetectionMatch,
    processToken: ProcessToken,
    now: ContinuousClock.Instant
  ) -> AgentDetectionState {
    if self.processToken != processToken {
      self.processToken = processToken
      state = .unknown
      pendingIdle = nil
    }

    switch match.result {
    case .unknown:
      return publish(.unknown)
    case .running:
      return publish(.running)
    case .needsInput:
      return publish(.needsInput)
    case .hold:
      pendingIdle = nil
      return state
    case .idle where match.visibleIdle:
      return publish(.idle)
    case .idle:
      return settleIdle(now: now)
    }
  }

  private mutating func settleIdle(now: ContinuousClock.Instant) -> AgentDetectionState {
    guard state == .running else { return publish(.idle) }
    let confirmations: Int
    let startedAt: ContinuousClock.Instant
    if let pendingIdle {
      confirmations = pendingIdle.confirmations + 1
      startedAt = pendingIdle.startedAt
    } else {
      confirmations = 0
      startedAt = now
    }
    if confirmations >= 3 || startedAt.duration(to: now) >= .milliseconds(700) {
      return publish(.idle)
    }
    pendingIdle = PendingIdle(confirmations: confirmations, startedAt: startedAt)
    return state
  }

  private mutating func publish(_ state: AgentDetectionState) -> AgentDetectionState {
    self.state = state
    pendingIdle = nil
    return state
  }

  private struct PendingIdle: Sendable {
    let confirmations: Int
    let startedAt: ContinuousClock.Instant
  }
}
