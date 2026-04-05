import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct CodexSettingsClient: Sendable {
  var hasSupatermHooks: @Sendable () async throws -> Bool
  var installSupatermHooks: @Sendable () async throws -> Void
  var removeSupatermHooks: @Sendable () async throws -> Void
}

extension CodexSettingsClient: DependencyKey {
  static let liveValue = Self(
    hasSupatermHooks: {
      try CodexSettingsInstaller().hasSupatermHooks()
    },
    installSupatermHooks: {
      try CodexSettingsInstaller().installSupatermHooks()
    },
    removeSupatermHooks: {
      try CodexSettingsInstaller().removeSupatermHooks()
    }
  )

  static let testValue = Self(
    hasSupatermHooks: { false },
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
