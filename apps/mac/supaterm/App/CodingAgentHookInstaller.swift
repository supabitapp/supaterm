import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated struct CodingAgentHookInstaller: Sendable {
  let isAvailable: @Sendable (SupatermAgentKind) throws -> Bool
  let integrationHealth: @Sendable (SupatermAgentKind) throws -> CodingAgentIntegrationHealth
  let installSupatermHooks: @Sendable (SupatermAgentKind) throws -> Void
  let configureForSupaterm: @Sendable (SupatermAgentKind) throws -> Void
  let removeSupatermHooks: @Sendable (SupatermAgentKind) throws -> Void

  static let live = Self(
    isAvailable: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        return try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).isAvailable()
      case .codex:
        return try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).isAvailable()
      case .pi:
        return try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL).isPiAvailable()
      }
    },
    integrationHealth: { agent in
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
    installSupatermHooks: { agent in
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
    configureForSupaterm: { agent in
      let homeDirectoryURL = Self.homeDirectoryURL()
      switch agent {
      case .claude:
        try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).configureForSupaterm()
      case .codex:
        try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL).configureForSupaterm()
      case .pi:
        break
      }
    },
    removeSupatermHooks: { agent in
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
