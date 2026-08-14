import Foundation

public enum AgentDetectionRuleOrigin: Equatable, Sendable {
  case embedded
}

public struct AgentDetectionAgentIdentity: Equatable, Hashable, Sendable {
  public let id: String
  public let displayName: String

  public init(id: String, displayName: String) {
    self.id = id
    self.displayName = displayName
  }
}

public struct AgentDetectionRuleSnapshot: Equatable, Sendable {
  public let origin: AgentDetectionRuleOrigin
  public let generation: UInt64
  public let processManifests: [AgentDetectionProcessManifest]

  public init(
    origin: AgentDetectionRuleOrigin,
    generation: UInt64,
    processManifests: [AgentDetectionProcessManifest]
  ) {
    self.origin = origin
    self.generation = generation
    self.processManifests = processManifests
  }
}

public struct AgentDetectionEvaluation: Equatable, Sendable {
  public let identity: AgentDetectionAgentIdentity
  public let generation: UInt64
  public let match: AgentDetectionMatch

  public init(
    identity: AgentDetectionAgentIdentity,
    generation: UInt64,
    match: AgentDetectionMatch
  ) {
    self.identity = identity
    self.generation = generation
    self.match = match
  }
}

public actor AgentDetectionRuleRepository {
  private let ruleSet: AgentDetectionRuleSet
  private let matchers: [AgentDetectionMatcher]

  public init(bundle: Bundle) throws {
    let ruleSet = try AgentDetectionRuleSetParser.load(from: bundle)
    self.ruleSet = ruleSet
    matchers = try ruleSet.agents.map(AgentDetectionMatcher.init)
  }

  public func snapshot() -> AgentDetectionRuleSnapshot {
    AgentDetectionRuleSnapshot(
      origin: .embedded,
      generation: ruleSet.generation,
      processManifests: ruleSet.agents.map {
        AgentDetectionProcessManifest(agentID: $0.id, processes: $0.processes)
      }
    )
  }

  public func evaluate(
    agentID: String,
    input: AgentDetectionInput
  ) -> AgentDetectionEvaluation? {
    guard let index = ruleSet.agents.firstIndex(where: { $0.id == agentID }) else {
      return nil
    }
    let agent = ruleSet.agents[index]
    return AgentDetectionEvaluation(
      identity: AgentDetectionAgentIdentity(id: agent.id, displayName: agent.displayName),
      generation: ruleSet.generation,
      match: matchers[index].match(input)
    )
  }
}
