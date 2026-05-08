import Foundation
import Sentry
import SupatermCLIShared

nonisolated struct StartupAgentHookRefresher {
  struct Operation: Sendable {
    let agent: SupatermAgentKind
    let hasSupatermHooks: @Sendable () throws -> Bool
    let installSupatermHooks: @Sendable () throws -> Void
  }

  let operations: [Operation]
  let logFailure: @Sendable (SupatermAgentKind, Error) -> Void

  static let live = StartupAgentHookRefresher(
    operations: [
      Operation(
        agent: .claude,
        hasSupatermHooks: {
          try ClaudeSettingsInstaller().hasSupatermHooks()
        },
        installSupatermHooks: {
          try ClaudeSettingsInstaller().installSupatermHooks()
        }
      ),
      Operation(
        agent: .codex,
        hasSupatermHooks: {
          try CodexSettingsInstaller().hasSupatermHooks()
        },
        installSupatermHooks: {
          try CodexSettingsInstaller().installSupatermHooks()
        }
      ),
    ],
    logFailure: { agent, error in
      let message = "Failed to refresh \(agent.notificationTitle) hooks at launch."
      SentrySDK.logger.warn(
        message,
        attributes: [
          "agent": agent.rawValue,
          "error": error.localizedDescription,
        ]
      )
      let breadcrumb = Breadcrumb(level: .warning, category: "agent-hooks")
      breadcrumb.message = message
      breadcrumb.data = [
        "agent": agent.rawValue,
        "error": error.localizedDescription,
      ]
      SentrySDK.addBreadcrumb(breadcrumb)
    }
  )

  func refreshInstalledHooks() {
    for operation in operations {
      do {
        guard try operation.hasSupatermHooks() else { continue }
        try operation.installSupatermHooks()
      } catch {
        logFailure(operation.agent, error)
      }
    }
  }
}
