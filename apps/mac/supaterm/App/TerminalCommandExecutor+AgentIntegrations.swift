import Foundation
import SupatermCLIShared

@MainActor
extension TerminalCommandExecutor {
  func setupAgentIntegration(
    _ request: SupatermAgentIntegrationRequest,
    manager: CodingAgentIntegrationManager = .live
  ) async throws -> SupatermAgentIntegrationResult {
    try await Task.detached(priority: .utility) {
      SupatermAgentIntegrationResult(
        agent: request.agent,
        health: try manager.setup(request.agent)
      )
    }.value
  }

  func removeAgentIntegration(
    _ request: SupatermAgentIntegrationRequest,
    manager: CodingAgentIntegrationManager = .live
  ) async throws -> SupatermAgentIntegrationResult {
    try await Task.detached(priority: .utility) {
      try manager.remove(request.agent)
      return SupatermAgentIntegrationResult(
        agent: request.agent,
        health: try manager.health(request.agent)
      )
    }.value
  }
}
