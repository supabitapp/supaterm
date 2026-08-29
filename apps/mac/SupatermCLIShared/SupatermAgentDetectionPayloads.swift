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
