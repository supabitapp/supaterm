import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct CodexSettingsClient: Sendable {
  var installSupatermHooks: @Sendable () async throws -> Void
}

extension CodexSettingsClient: DependencyKey {
  static let liveValue = Self(
    installSupatermHooks: {
      try BundledSPAgentHooksInstaller().installSupatermHooks(for: .codex)
    }
  )

  static let testValue = Self(
    installSupatermHooks: {}
  )
}

extension DependencyValues {
  var codexSettingsClient: CodexSettingsClient {
    get { self[CodexSettingsClient.self] }
    set { self[CodexSettingsClient.self] = newValue }
  }
}
