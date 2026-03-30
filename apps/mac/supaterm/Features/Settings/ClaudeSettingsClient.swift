import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct ClaudeSettingsClient: Sendable {
  var installSupatermHooks: @Sendable () async throws -> Void
}

extension ClaudeSettingsClient: DependencyKey {
  static let liveValue = Self(
    installSupatermHooks: {
      try BundledSPAgentHooksInstaller().installSupatermHooks(for: .claude)
    }
  )

  static let testValue = Self(
    installSupatermHooks: {}
  )
}

extension DependencyValues {
  var claudeSettingsClient: ClaudeSettingsClient {
    get { self[ClaudeSettingsClient.self] }
    set { self[ClaudeSettingsClient.self] = newValue }
  }
}
