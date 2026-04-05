import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct ClaudeSettingsClient: Sendable {
  var hasSupatermHooks: @Sendable () async throws -> Bool
  var installSupatermHooks: @Sendable () async throws -> Void
  var removeSupatermHooks: @Sendable () async throws -> Void
}

extension ClaudeSettingsClient: DependencyKey {
  static let liveValue = Self(
    hasSupatermHooks: {
      try ClaudeSettingsInstaller().hasSupatermHooks()
    },
    installSupatermHooks: {
      try ClaudeSettingsInstaller().installSupatermHooks()
    },
    removeSupatermHooks: {
      try ClaudeSettingsInstaller().removeSupatermHooks()
    }
  )

  static let testValue = Self(
    hasSupatermHooks: { false },
    installSupatermHooks: {},
    removeSupatermHooks: {}
  )
}

extension DependencyValues {
  var claudeSettingsClient: ClaudeSettingsClient {
    get { self[ClaudeSettingsClient.self] }
    set { self[ClaudeSettingsClient.self] = newValue }
  }
}
