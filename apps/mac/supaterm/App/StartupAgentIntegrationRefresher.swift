import Foundation
import SupatermCLIShared

nonisolated struct StartupAgentIntegrationRefresher {
  struct Operation: Sendable {
    let agent: SupatermAgentKind
    let health: @Sendable () throws -> CodingAgentIntegrationHealth
    let repair: @Sendable () throws -> Void
  }

  let operations: [Operation]
  let logFailure: @Sendable (SupatermAgentKind, Error) -> Void

  static let live = StartupAgentIntegrationRefresher(
    operations: SupatermAgentKind.managedIntegrationCases.map { agent in
      Operation(
        agent: agent,
        health: {
          try CodingAgentIntegrationManager.live.health(agent)
        },
        repair: {
          try CodingAgentIntegrationManager.live.repair(agent)
        }
      )
    },
    logFailure: { agent, error in
      let message = "Failed to repair the \(agent.notificationTitle) integration at launch."
      AppPostHog.captureException(
        error,
        properties: [
          "agent": agent.rawValue,
          "category": "agent-integration",
          "message": message,
        ]
      )
    }
  )

  func repairIntegrations() {
    for operation in operations {
      do {
        switch try operation.health() {
        case .partial, .drifted:
          try operation.repair()
        case .unavailable, .unavailableInstalled, .absent, .healthy:
          continue
        }
      } catch {
        logFailure(operation.agent, error)
      }
    }
  }
}
