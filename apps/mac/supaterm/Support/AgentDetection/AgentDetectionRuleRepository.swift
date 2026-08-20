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

public struct AgentDetectionSignalRequest: Equatable, Sendable {
  public let agentID: String
  public let input: AgentDetectionSignalInput

  public init(agentID: String, input: AgentDetectionSignalInput) {
    self.agentID = agentID
    self.input = input
  }
}

public enum AgentDetectionSignalEvaluation: Equatable, Sendable {
  case matched(AgentDetectionEvaluation)
  case needsScreen(generation: UInt64)

  public var generation: UInt64 {
    switch self {
    case .matched(let evaluation):
      evaluation.generation
    case .needsScreen(let generation):
      generation
    }
  }
}

public struct AgentDetectionEvaluationRequest: Equatable, Sendable {
  public let agentID: String
  public let input: AgentDetectionInput

  public init(agentID: String, input: AgentDetectionInput) {
    self.agentID = agentID
    self.input = input
  }
}

public actor AgentDetectionRuleRepository {
  private struct CompiledAgent {
    let identity: AgentDetectionAgentIdentity
    let matcher: AgentDetectionMatcher
  }

  private let snapshotValue: AgentDetectionRuleSnapshot
  private let agentsByID: [String: CompiledAgent]

  public init(bundle: Bundle) throws {
    let ruleSet = try AgentDetectionRuleSetParser.load(from: bundle)
    snapshotValue = AgentDetectionRuleSnapshot(
      origin: .embedded,
      generation: ruleSet.generation,
      processManifests: ruleSet.agents.map {
        AgentDetectionProcessManifest(agentID: $0.id, processes: $0.processes)
      }
    )
    agentsByID = try Dictionary(
      uniqueKeysWithValues: ruleSet.agents.map { agent in
        (
          agent.id,
          CompiledAgent(
            identity: AgentDetectionAgentIdentity(
              id: agent.id,
              displayName: agent.displayName
            ),
            matcher: try AgentDetectionMatcher(agent: agent)
          )
        )
      }
    )
  }

  public func snapshot() -> AgentDetectionRuleSnapshot {
    snapshotValue
  }

  public func evaluateSignals(
    _ requests: [AgentDetectionSignalRequest]
  ) -> [AgentDetectionSignalEvaluation?] {
    requests.map { request in
      guard let agent = agentsByID[request.agentID] else { return nil }
      switch agent.matcher.matchSignals(request.input) {
      case .matched(let match):
        return .matched(
          AgentDetectionEvaluation(
            identity: agent.identity,
            generation: snapshotValue.generation,
            match: match
          )
        )
      case .needsScreen:
        return .needsScreen(generation: snapshotValue.generation)
      }
    }
  }

  public func evaluate(
    _ requests: [AgentDetectionEvaluationRequest]
  ) -> [AgentDetectionEvaluation?] {
    requests.map { request in
      guard let agent = agentsByID[request.agentID] else { return nil }
      return AgentDetectionEvaluation(
        identity: agent.identity,
        generation: snapshotValue.generation,
        match: agent.matcher.match(request.input)
      )
    }
  }
}
