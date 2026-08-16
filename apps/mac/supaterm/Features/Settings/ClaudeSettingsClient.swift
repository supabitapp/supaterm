import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport

struct ClaudeSettingsClient: Sendable {
  var integrationHealth: @Sendable () async throws -> CodingAgentIntegrationHealth
  var installSupatermHooks: @Sendable () async throws -> Void
  var removeSupatermHooks: @Sendable () async throws -> Void
}

extension ClaudeSettingsClient: DependencyKey {
  static let liveValue = Self(
    integrationHealth: {
      try ClaudeSettingsInstaller().integrationHealth()
    },
    installSupatermHooks: {
      try ClaudeSettingsInstaller().installSupatermHooks()
    },
    removeSupatermHooks: {
      try ClaudeSettingsInstaller().removeSupatermHooks()
    }
  )

  static let testValue = Self(
    integrationHealth: unimplemented("ClaudeSettingsClient.integrationHealth"),
    installSupatermHooks: unimplemented("ClaudeSettingsClient.installSupatermHooks"),
    removeSupatermHooks: unimplemented("ClaudeSettingsClient.removeSupatermHooks")
  )
}

extension DependencyValues {
  var claudeSettingsClient: ClaudeSettingsClient {
    get { self[ClaudeSettingsClient.self] }
    set { self[ClaudeSettingsClient.self] = newValue }
  }
}
