import Foundation
import SupatermCLIShared

@MainActor
extension TerminalCommandExecutor {
  func hooksInstall(
    _ request: SupatermAgentHookTargetRequest,
    installer: CodingAgentHookInstaller = .live
  ) async throws -> SupatermAgentHookHealth {
    try await Task.detached(priority: .utility) {
      guard try installer.isAvailable(request.agent) else {
        return SupatermAgentHookHealth(agent: request.agent, health: .unavailable)
      }
      try installer.installSupatermHooks(request.agent)
      return SupatermAgentHookHealth(
        agent: request.agent,
        health: try installer.integrationHealth(request.agent)
      )
    }.value
  }

  func hooksRemove(
    _ request: SupatermAgentHookTargetRequest,
    installer: CodingAgentHookInstaller = .live
  ) async throws -> SupatermAgentHookHealth {
    try await Task.detached(priority: .utility) {
      try installer.removeSupatermHooks(request.agent)
      return SupatermAgentHookHealth(
        agent: request.agent,
        health: try installer.integrationHealth(request.agent)
      )
    }.value
  }
}
