import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated struct CodingAgentIntegrationManager: Sendable {
  let setup: @Sendable (SupatermAgentKind) throws -> CodingAgentIntegrationHealth
  let health: @Sendable (SupatermAgentKind) throws -> CodingAgentIntegrationHealth
  let repair: @Sendable (SupatermAgentKind) throws -> Void
  let remove: @Sendable (SupatermAgentKind) throws -> Void

  static let live = Self(
    setup: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        return try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).setup()
      case .codex:
        return try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).setup()
      case .pi:
        return try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL).setup()
      }
    },
    health: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        return try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).integrationHealth()
      case .codex:
        return try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).integrationHealth()
      case .pi:
        return try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL).integrationHealth()
      }
    },
    repair: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()
      case .codex:
        try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()
      case .pi:
        try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermPackage()
      }
    },
    remove: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).removeSupatermHooks()
      case .codex:
        try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).removeSupatermHooks()
      case .pi:
        try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL).removeSupatermPackage()
      }
    }
  )

  static func homeDirectoryURL(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    defaultHomeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> URL {
    guard
      environment["SUPATERM_TEST_MODE"] == "1",
      let rawPath = environment[SupatermCLIEnvironment.testHomeKey]
    else {
      return defaultHomeDirectoryURL
    }
    let path = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty else { return defaultHomeDirectoryURL }
    return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
  }
}
