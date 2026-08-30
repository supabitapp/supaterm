import Foundation

public enum SupatermAgentHookManagementTiming {
  public static let piAvailabilityTimeout: TimeInterval = 10
  public static let piMutationTimeout: TimeInterval = 60
  public static let maxPiMutationsPerRequest = 3
  public static let serverReplyTimeout =
    piMutationTimeout * TimeInterval(maxPiMutationsPerRequest + 1)
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
