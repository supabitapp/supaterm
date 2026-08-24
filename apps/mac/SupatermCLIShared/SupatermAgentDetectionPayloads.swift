import Foundation

public enum SupatermAgentDetectionManifestOrigin: String, Equatable, Sendable, Codable {
  case bundled
  case local
}

public struct SupatermAgentDetectionManifestInfo: Equatable, Sendable, Codable {
  public let agentID: String
  public let displayName: String
  public let version: String?
  public let origin: SupatermAgentDetectionManifestOrigin
  public let path: String

  public init(
    agentID: String,
    displayName: String,
    version: String?,
    origin: SupatermAgentDetectionManifestOrigin,
    path: String
  ) {
    self.agentID = agentID
    self.displayName = displayName
    self.version = version
    self.origin = origin
    self.path = path
  }
}

public struct SupatermAgentDetectionReloadResult: Equatable, Sendable, Codable {
  public let generation: UInt64
  public let overrideDirectory: String
  public let manifests: [SupatermAgentDetectionManifestInfo]

  public init(
    generation: UInt64,
    overrideDirectory: String,
    manifests: [SupatermAgentDetectionManifestInfo]
  ) {
    self.generation = generation
    self.overrideDirectory = overrideDirectory
    self.manifests = manifests
  }
}

public struct SupatermAgentDetectionExplainRequest: Equatable, Sendable, Codable {
  public let target: SupatermPaneTargetRequest

  public init(target: SupatermPaneTargetRequest) {
    self.target = target
  }
}

public enum SupatermAgentDetectionRuleState: String, Equatable, Sendable, Codable {
  case unknown
  case idle
  case running
  case needsInput = "needs_input"
  case hold
}

public struct SupatermAgentDetectionConditionEvidence: Equatable, Sendable, Codable {
  public let kind: String
  public let value: String?
  public let matched: Bool
  public let children: [SupatermAgentDetectionConditionEvidence]

  public init(
    kind: String,
    value: String?,
    matched: Bool,
    children: [SupatermAgentDetectionConditionEvidence]
  ) {
    self.kind = kind
    self.value = value
    self.matched = matched
    self.children = children
  }
}

public struct SupatermAgentDetectionRuleEvidence: Equatable, Sendable, Codable {
  public let ruleID: String
  public let state: SupatermAgentDetectionRuleState
  public let priority: Int
  public let region: String
  public let matched: Bool
  public let condition: SupatermAgentDetectionConditionEvidence

  public init(
    ruleID: String,
    state: SupatermAgentDetectionRuleState,
    priority: Int,
    region: String,
    matched: Bool,
    condition: SupatermAgentDetectionConditionEvidence
  ) {
    self.ruleID = ruleID
    self.state = state
    self.priority = priority
    self.region = region
    self.matched = matched
    self.condition = condition
  }
}

public struct SupatermAgentDetectionExplainResult: Equatable, Sendable, Codable {
  public let target: SupatermPaneTarget
  public let status: SupatermAppDebugSnapshot.AgentDetectionStatus
  public let generation: UInt64?
  public let agentID: String?
  public let displayName: String?
  public let phase: SupatermAppDebugSnapshot.AgentPhase?
  public let process: SupatermAppDebugSnapshot.AgentProcess?
  public let manifest: SupatermAgentDetectionManifestInfo?
  public let matchedRuleID: String?
  public let publishedRuleID: String?
  public let rules: [SupatermAgentDetectionRuleEvidence]

  public init(
    target: SupatermPaneTarget,
    status: SupatermAppDebugSnapshot.AgentDetectionStatus,
    generation: UInt64?,
    agentID: String?,
    displayName: String?,
    phase: SupatermAppDebugSnapshot.AgentPhase?,
    process: SupatermAppDebugSnapshot.AgentProcess?,
    manifest: SupatermAgentDetectionManifestInfo?,
    matchedRuleID: String?,
    publishedRuleID: String?,
    rules: [SupatermAgentDetectionRuleEvidence]
  ) {
    self.target = target
    self.status = status
    self.generation = generation
    self.agentID = agentID
    self.displayName = displayName
    self.phase = phase
    self.process = process
    self.manifest = manifest
    self.matchedRuleID = matchedRuleID
    self.publishedRuleID = publishedRuleID
    self.rules = rules
  }
}
