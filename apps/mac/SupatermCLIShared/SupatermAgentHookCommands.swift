import Foundation

public enum SupatermAgentHookManagementTiming {
  public static let serverReplyTimeout: TimeInterval = 60
  public static let clientResponseTimeout = serverReplyTimeout + 5
}

public struct SupatermAgentHookTargetRequest: Codable, Equatable, Sendable {
  public let agent: SupatermAgentKind

  public init(agent: SupatermAgentKind) {
    self.agent = agent
  }
}

public struct SupatermAgentHookHealth: Codable, Equatable, Sendable {
  public let agent: SupatermAgentKind
  public let health: CodingAgentIntegrationHealth

  public init(agent: SupatermAgentKind, health: CodingAgentIntegrationHealth) {
    self.agent = agent
    self.health = health
  }
}
