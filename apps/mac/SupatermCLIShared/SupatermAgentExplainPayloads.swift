import Foundation

public struct SupatermAgentExplainResult: Codable, Equatable, Sendable {
  public enum Mode: String, Codable, Equatable, Sendable {
    case native
    case fallback
    case none
  }

  public enum Status: String, Codable, Equatable, Sendable {
    case detectionDisabled = "detection_disabled"
    case waiting
    case noForegroundProcess = "no_foreground_process"
    case unrecognizedProcess = "unrecognized_process"
    case nativeAuthority = "native_authority"
    case screenUnavailable = "screen_unavailable"
    case noRuleMatchOrSettling = "no_rule_match_or_settling"
    case resolved
  }

  public enum Phase: String, Codable, Equatable, Sendable {
    case idle
    case running
    case needsInput = "needs_input"
  }

  public enum RuleSource: String, Codable, Equatable, Sendable {
    case embedded
  }

  public struct Rules: Codable, Equatable, Sendable {
    public let source: RuleSource
    public let generation: UInt64

    public init(source: RuleSource, generation: UInt64) {
      self.source = source
      self.generation = generation
    }
  }

  public struct Agent: Codable, Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let phase: Phase

    public init(id: String, displayName: String, phase: Phase) {
      self.id = id
      self.displayName = displayName
      self.phase = phase
    }
  }

  public struct Process: Codable, Equatable, Sendable {
    public let processID: Int32
    public let startTimeMicroseconds: UInt64

    public init(processID: Int32, startTimeMicroseconds: UInt64) {
      self.processID = processID
      self.startTimeMicroseconds = startTimeMicroseconds
    }
  }

  public let target: SupatermPaneTarget
  public let mode: Mode
  public let status: Status
  public let rules: Rules?
  public let agent: Agent?
  public let process: Process?
  public let ruleID: String?

  public init(
    target: SupatermPaneTarget,
    mode: Mode,
    status: Status,
    rules: Rules?,
    agent: Agent?,
    process: Process?,
    ruleID: String?
  ) {
    self.target = target
    self.mode = mode
    self.status = status
    self.rules = rules
    self.agent = agent
    self.process = process
    self.ruleID = ruleID
  }
}
