struct AgentDetectionRuleSet: Equatable, Sendable {
  let agents: [AgentDetectionAgentRule]
}

struct AgentDetectionAgentRule: Equatable, Sendable {
  let id: String
  let displayName: String
  let processes: [AgentDetectionProcessRule]
  let rules: [AgentDetectionStateRule]
}

struct AgentDetectionStateRule: Equatable, Sendable {
  let id: String
  let result: AgentDetectionRuleResult
  let priority: Int
  let region: AgentDetectionRegion
  let visibleIdle: Bool
  let gate: AgentDetectionGate

  init(
    id: String,
    result: AgentDetectionRuleResult,
    priority: Int,
    region: AgentDetectionRegion,
    visibleIdle: Bool = false,
    gate: AgentDetectionGate
  ) {
    self.id = id
    self.result = result
    self.priority = priority
    self.region = region
    self.visibleIdle = visibleIdle
    self.gate = gate
  }
}

public enum AgentDetectionRuleResult: Equatable, Sendable {
  case running
  case needsInput
  case idle
  case hold
}

enum AgentDetectionRegion: Equatable, Sendable {
  case wholeRecent
  case bottomNonEmptyLines(Int)
  case topNonEmptyLines(Int)
  case afterLastPromptMarker
  case promptBoxBody
  case afterLastHorizontalRule
  case oscTitle
  case oscProgress
}

struct AgentDetectionGate: Equatable, Sendable {
  let contains: [String]
  let regex: [String]
  let lineRegex: [String]
  let all: [AgentDetectionGate]
  let any: [AgentDetectionGate]
  let not: [AgentDetectionGate]

  init(
    contains: [String] = [],
    regex: [String] = [],
    lineRegex: [String] = [],
    all: [AgentDetectionGate] = [],
    any: [AgentDetectionGate] = [],
    not: [AgentDetectionGate] = []
  ) {
    self.contains = contains
    self.regex = regex
    self.lineRegex = lineRegex
    self.all = all
    self.any = any
    self.not = not
  }
}
