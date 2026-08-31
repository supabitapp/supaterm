import Foundation

public enum SupatermAgentIntegrationTiming {
  public static let serverReplyTimeout: TimeInterval = 240
  public static let clientResponseTimeout = serverReplyTimeout + 5
}

public struct SupatermAgentIntegrationRequest: Codable, Equatable, Sendable {
  public let agent: SupatermAgentKind

  public init(agent: SupatermAgentKind) {
    self.agent = agent
  }
}

public struct SupatermAgentIntegrationResult: Codable, Equatable, Sendable {
  public let agent: SupatermAgentKind
  public let health: CodingAgentIntegrationHealth

  public init(agent: SupatermAgentKind, health: CodingAgentIntegrationHealth) {
    self.agent = agent
    self.health = health
  }
}
