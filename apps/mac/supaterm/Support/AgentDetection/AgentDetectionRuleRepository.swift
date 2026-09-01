import Foundation

public struct AgentDetectionAgentIdentity: Equatable, Hashable, Sendable {
  public let id: String
  public let displayName: String

  public init(id: String, displayName: String) {
    self.id = id
    self.displayName = displayName
  }
}

public struct AgentDetectionRuleSnapshot: Equatable, Sendable {
  public let generation: UInt64
  public let manifests: [AgentDetectionManifestSnapshot]
  public let processManifests: [AgentDetectionProcessManifest]

  public init(
    generation: UInt64,
    manifests: [AgentDetectionManifestSnapshot],
    processManifests: [AgentDetectionProcessManifest]
  ) {
    self.generation = generation
    self.manifests = manifests
    self.processManifests = processManifests
  }
}

public struct AgentDetectionManifestSnapshot: Equatable, Sendable {
  public let agent: AgentDetectionAgentIdentity
  public let version: String?
  public let source: AgentDetectionManifestSource

  public init(
    agent: AgentDetectionAgentIdentity,
    version: String?,
    source: AgentDetectionManifestSource
  ) {
    self.agent = agent
    self.version = version
    self.source = source
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
    let manifest: AgentDetectionManifestSnapshot
    let processManifest: AgentDetectionProcessManifest
    let matcher: AgentDetectionMatcher
  }

  private struct ActiveRules {
    let generation: UInt64
    let agents: [CompiledAgent]

    var snapshot: AgentDetectionRuleSnapshot {
      AgentDetectionRuleSnapshot(
        generation: generation,
        manifests: agents.map(\.manifest),
        processManifests: agents.map(\.processManifest)
      )
    }

    func agent(id: String) -> CompiledAgent? {
      agents.first { $0.identity.id == id }
    }
  }

  private let bundle: Bundle
  private let overrideDirectoryURL: URL?
  public nonisolated let startupFallbackErrorDescription: String?
  private var active: ActiveRules

  public init(
    bundle: Bundle,
    overrideDirectoryURL: URL? = nil,
    fallsBackToBundledRules: Bool = false
  ) throws {
    self.bundle = bundle
    self.overrideDirectoryURL = overrideDirectoryURL
    do {
      active = try Self.compile(
        AgentDetectionRuleSetParser.load(
          from: bundle,
          overrideDirectoryURL: overrideDirectoryURL
        )
      )
      startupFallbackErrorDescription = nil
    } catch {
      guard fallsBackToBundledRules else { throw error }
      active = try Self.compile(AgentDetectionRuleSetParser.load(from: bundle))
      startupFallbackErrorDescription = error.localizedDescription
    }
  }

  private static func compile(_ ruleSet: AgentDetectionRuleSet) throws -> ActiveRules {
    let agents = try ruleSet.agents.map { agent in
      let identity = AgentDetectionAgentIdentity(
        id: agent.id,
        displayName: agent.displayName
      )
      return CompiledAgent(
        identity: identity,
        manifest: AgentDetectionManifestSnapshot(
          agent: identity,
          version: agent.version,
          source: agent.source
        ),
        processManifest: AgentDetectionProcessManifest(
          agentID: agent.id,
          processes: agent.processes
        ),
        matcher: try AgentDetectionMatcher(agent: agent)
      )
    }
    return ActiveRules(
      generation: ruleSet.generation,
      agents: agents
    )
  }

  public func snapshot() -> AgentDetectionRuleSnapshot {
    active.snapshot
  }

  public func reload() throws -> AgentDetectionRuleSnapshot {
    let replacement = try Self.compile(
      AgentDetectionRuleSetParser.load(
        from: bundle,
        overrideDirectoryURL: overrideDirectoryURL
      )
    )
    active = replacement
    return replacement.snapshot
  }

  public func overrideDirectoryPath() -> String? {
    overrideDirectoryURL?.path
  }

  public func evaluateSignals(
    _ requests: [AgentDetectionSignalRequest]
  ) -> [AgentDetectionSignalEvaluation?] {
    requests.map { request in
      guard let agent = active.agent(id: request.agentID) else { return nil }
      switch agent.matcher.matchSignals(request.input) {
      case .matched(let match):
        return .matched(
          AgentDetectionEvaluation(
            identity: agent.identity,
            generation: active.generation,
            match: match
          )
        )
      case .needsScreen:
        return .needsScreen(generation: active.generation)
      }
    }
  }

  public func evaluate(
    _ requests: [AgentDetectionEvaluationRequest]
  ) -> [AgentDetectionEvaluation?] {
    requests.map { request in
      guard let agent = active.agent(id: request.agentID) else { return nil }
      return AgentDetectionEvaluation(
        identity: agent.identity,
        generation: active.generation,
        match: agent.matcher.match(request.input)
      )
    }
  }
}
