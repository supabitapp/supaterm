import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct CodexSettingsClient: Sendable {
  var integrationHealth: @Sendable () async throws -> CodingAgentIntegrationHealth
  var installSupatermHooks: @Sendable () async throws -> Void
  var removeSupatermHooks: @Sendable () async throws -> Void
}

extension CodexSettingsClient: DependencyKey {
  static let liveValue = Self(
    integrationHealth: {
      try CodexSettingsInstaller().integrationHealth()
    },
    installSupatermHooks: {
      try CodexSettingsInstaller().installSupatermHooks()
    },
    removeSupatermHooks: {
      try CodexSettingsInstaller().removeSupatermHooks()
    }
  )

  static let testValue = Self(
    integrationHealth: { .absent },
    installSupatermHooks: {},
    removeSupatermHooks: {}
  )
}

extension DependencyValues {
  var codexSettingsClient: CodexSettingsClient {
    get { self[CodexSettingsClient.self] }
    set { self[CodexSettingsClient.self] = newValue }
  }
}
