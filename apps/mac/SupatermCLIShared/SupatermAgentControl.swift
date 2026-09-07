import Foundation

public struct SupatermAgentIdentity: Equatable, Sendable, Codable {
  public let kind: SupatermAgentKind
  public let process: SupatermAppDebugSnapshot.AgentProcess

  public init(kind: SupatermAgentKind, process: SupatermAppDebugSnapshot.AgentProcess) {
    self.kind = kind
    self.process = process
  }
}

public struct SupatermAgentGuard: Equatable, Sendable, Codable {
  public let kind: SupatermAgentKind
  public let process: SupatermAppDebugSnapshot.AgentProcess?

  public init(kind: SupatermAgentKind, process: SupatermAppDebugSnapshot.AgentProcess? = nil) {
    self.kind = kind
    self.process = process
  }

  public func validate() throws {
    if let process, process.processID <= 0 || process.startTimeMicroseconds == 0 {
      throw SupatermAgentControlError.invalidRequest("Expected process must have a positive PID and start time.")
    }
  }

  public func matches(_ identity: SupatermAgentIdentity) -> Bool {
    kind == identity.kind && (process == nil || process == identity.process)
  }
}

public enum SupatermAgentWaitState: String, Equatable, Sendable, Codable, CaseIterable {
  case idle
  case running
  case needsInput = "needs_input"
  case exited
}

public struct SupatermAgentWaitRequest: Equatable, Sendable, Codable {
  public static let maximumTimeoutSeconds: Double = 3_600
  public static let serverReplyGraceSeconds: Double = 5
  public static let clientResponseGraceSeconds: Double = 10

  public let target: SupatermPaneTargetRequest
  public let until: [SupatermAgentWaitState]
  public let timeoutSeconds: Double
  public let expectedAgent: SupatermAgentGuard?

  public init(
    target: SupatermPaneTargetRequest,
    until: [SupatermAgentWaitState] = [.idle, .needsInput],
    timeoutSeconds: Double = 60,
    expectedAgent: SupatermAgentGuard? = nil
  ) {
    self.target = target
    self.until = until
    self.timeoutSeconds = timeoutSeconds
    self.expectedAgent = expectedAgent
  }

  public func validate() throws {
    guard timeoutSeconds.isFinite, timeoutSeconds > 0,
      timeoutSeconds <= Self.maximumTimeoutSeconds, !until.isEmpty
    else {
      throw SupatermAgentControlError.invalidRequest(
        "Wait needs at least one state and a timeout greater than 0 and at most 3600 seconds.")
    }
    try expectedAgent?.validate()
  }
}

public struct SupatermAgentWaitResult: Equatable, Sendable, Codable {
  public enum Outcome: String, Equatable, Sendable, Codable {
    case idle
    case running
    case needsInput = "needs_input"
    case exited
    case replaced
    case unknown
    case timeout

    public init?(phase: SupatermAppDebugSnapshot.AgentPhase) {
      switch phase {
      case .idle: self = .idle
      case .running: self = .running
      case .needsInput: self = .needsInput
      case .unknown: return nil
      }
    }

    public func matches(_ states: [SupatermAgentWaitState]) -> Bool {
      switch self {
      case .idle: states.contains(.idle)
      case .running: states.contains(.running)
      case .needsInput: states.contains(.needsInput)
      case .exited: states.contains(.exited)
      case .replaced, .unknown, .timeout: false
      }
    }
  }

  public let paneID: UUID
  public let outcome: Outcome
  public let matched: Bool
  public let identity: SupatermAgentIdentity?

  public init(paneID: UUID, outcome: Outcome, matched: Bool, identity: SupatermAgentIdentity?) {
    self.paneID = paneID
    self.outcome = outcome
    self.matched = matched
    self.identity = identity
  }
}

public enum SupatermAgentControlError: Error, LocalizedError, Equatable, Sendable {
  case invalidRequest(String)
  case notRunning
  case replaced
  case blocked
  case unknown

  public var code: String {
    switch self {
    case .invalidRequest: "invalid_request"
    case .notRunning: "agent_not_running"
    case .replaced: "agent_replaced"
    case .blocked: "agent_blocked"
    case .unknown: "agent_unknown"
    }
  }

  public var errorDescription: String? {
    switch self {
    case .invalidRequest(let message): message
    case .notRunning: "The expected agent is no longer running in this pane."
    case .replaced: "The pane's agent no longer matches the expected agent process."
    case .blocked: "The agent needs input. Inspect the pane before responding."
    case .unknown: "The agent's current state could not be established. No input was sent."
    }
  }
}
