import Foundation
import SupatermCLIShared

nonisolated struct StartupAgentHookRefresher {
  struct Operation: Sendable {
    let agent: SupatermAgentKind
    let integrationHealth: @Sendable () throws -> CodingAgentIntegrationHealth
    let installSupatermHooks: @Sendable () throws -> Void
  }

  let operations: [Operation]
  let logFailure: @Sendable (SupatermAgentKind, Error) -> Void

  static let live = StartupAgentHookRefresher(
    operations: [
      Operation(
        agent: .claude,
        integrationHealth: {
          try ClaudeSettingsInstaller().integrationHealth()
        },
        installSupatermHooks: {
          try ClaudeSettingsInstaller().installSupatermHooks()
        }
      ),
      Operation(
        agent: .codex,
        integrationHealth: {
          try CodexSettingsInstaller().integrationHealth()
        },
        installSupatermHooks: {
          try CodexSettingsInstaller().installSupatermHooks()
        }
      ),
      Operation(
        agent: .pi,
        integrationHealth: {
          try PiSettingsInstaller().integrationHealth()
        },
        installSupatermHooks: {
          try PiSettingsInstaller().installSupatermPackage()
        }
      ),
    ],
    logFailure: { agent, error in
      let message = "Failed to refresh \(agent.notificationTitle) hooks at launch."
      AppPostHog.captureException(
        error,
        properties: [
          "agent": agent.rawValue,
          "category": "agent-hooks",
          "message": message,
        ]
      )
    }
  )

  func refreshInstalledHooks() {
    for operation in operations {
      do {
        switch try operation.integrationHealth() {
        case .partial, .drifted:
          break
        case .unavailable, .unavailableInstalled, .absent, .healthy:
          continue
        }
        try operation.installSupatermHooks()
      } catch {
        logFailure(operation.agent, error)
      }
    }
  }
}
