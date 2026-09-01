import Foundation

public enum SupatermAgentIntegrationTiming {
  public static let availabilityTimeout: TimeInterval = 10
  public static let coordinationTimeout: TimeInterval = 5
  public static let mutationTimeout: TimeInterval = 60
  public static let maximumMutationsPerRequest = 3
  private static let serverReplyGracePeriod: TimeInterval = 50
  private static let clientResponseGracePeriod: TimeInterval = 5

  public static var setupBudget: TimeInterval {
    availabilityTimeout
      + mutationTimeout * TimeInterval(maximumMutationsPerRequest * 2 - 1)
  }

  public static var serverReplyTimeout: TimeInterval {
    setupBudget + serverReplyGracePeriod
  }

  public static var clientResponseTimeout: TimeInterval {
    serverReplyTimeout + clientResponseGracePeriod
  }
}

public struct SupatermAgentIntegrationRequest: Codable, Equatable, Sendable {
  public let agent: SupatermManagedAgentKind

  public init(agent: SupatermManagedAgentKind) {
    self.agent = agent
  }
}

public struct SupatermAgentIntegrationResult: Codable, Equatable, Sendable {
  public let agent: SupatermManagedAgentKind
  public let health: CodingAgentIntegrationHealth

  public init(agent: SupatermManagedAgentKind, health: CodingAgentIntegrationHealth) {
    self.agent = agent
    self.health = health
  }
}
