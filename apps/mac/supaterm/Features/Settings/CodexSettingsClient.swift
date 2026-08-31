import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport

struct CodexSettingsClient: Sendable {
  var integrationHealth: @Sendable () async throws -> CodingAgentIntegrationHealth
  var installSupatermHooks: @Sendable () async throws -> Void
  var removeSupatermHooks: @Sendable () async throws -> Void
}

extension CodexSettingsClient: DependencyKey {
  static let liveValue = Self(
    integrationHealth: {
      try CodingAgentIntegrationManager.live.health(.codex)
    },
    installSupatermHooks: {
      try CodingAgentIntegrationManager.live.repair(.codex)
    },
    removeSupatermHooks: {
      _ = try CodingAgentIntegrationManager.live.remove(.codex)
    }
  )

  static let testValue = Self(
    integrationHealth: unimplemented("CodexSettingsClient.integrationHealth"),
    installSupatermHooks: unimplemented("CodexSettingsClient.installSupatermHooks"),
    removeSupatermHooks: unimplemented("CodexSettingsClient.removeSupatermHooks")
  )
}

extension DependencyValues {
  var codexSettingsClient: CodexSettingsClient {
    get { self[CodexSettingsClient.self] }
    set { self[CodexSettingsClient.self] = newValue }
  }
}
