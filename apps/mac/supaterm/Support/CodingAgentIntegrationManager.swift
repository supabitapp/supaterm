import Foundation
import SupatermCLIShared

nonisolated public struct CodingAgentIntegrationManager: Sendable {
  struct Integration: Sendable {
    let setup: @Sendable () throws -> CodingAgentIntegrationHealth
    let health: @Sendable () throws -> CodingAgentIntegrationHealth
    let repair: @Sendable () throws -> Void
    let remove: @Sendable () throws -> Void
  }

  private struct Entry: Sendable {
    let integration: Integration
    let lock: NSLock
  }

  private let claude: Entry
  private let codex: Entry
  private let pi: Entry

  init(
    claude: Integration,
    codex: Integration,
    pi: Integration
  ) {
    self.claude = Entry(integration: claude, lock: NSLock())
    self.codex = Entry(integration: codex, lock: NSLock())
    self.pi = Entry(integration: pi, lock: NSLock())
  }

  public func setup(_ agent: SupatermAgentKind) throws -> CodingAgentIntegrationHealth {
    try withIntegration(for: agent) { try $0.setup() }
  }

  public func health(_ agent: SupatermAgentKind) throws -> CodingAgentIntegrationHealth {
    try withIntegration(for: agent) { try $0.health() }
  }

  public func repair(_ agent: SupatermAgentKind) throws {
    try withIntegration(for: agent) { try $0.repair() }
  }

  public func remove(_ agent: SupatermAgentKind) throws -> CodingAgentIntegrationHealth {
    try withIntegration(for: agent) {
      try $0.remove()
      return try $0.health()
    }
  }

  public static let live: Self = {
    Self(
      claude: Integration(
        setup: {
          try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).setup()
        },
        health: {
          try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).integrationHealth()
        },
        repair: {
          try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).installSupatermHooks()
        },
        remove: {
          try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).removeSupatermHooks()
        }
      ),
      codex: Integration(
        setup: {
          try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).setup()
        },
        health: {
          try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).integrationHealth()
        },
        repair: {
          try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).installSupatermHooks()
        },
        remove: {
          try CodexSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).removeSupatermHooks()
        }
      ),
      pi: Integration(
        setup: {
          try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).setup()
        },
        health: {
          try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).integrationHealth()
        },
        repair: {
          try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).installSupatermPackage()
        },
        remove: {
          try PiSettingsInstaller(homeDirectoryURL: homeDirectoryURL()).removeSupatermPackage()
        }
      )
    )
  }()

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

  private func withIntegration<Result>(
    for agent: SupatermAgentKind,
    _ operation: (Integration) throws -> Result
  ) rethrows -> Result {
    let entry = entry(for: agent)
    return try entry.lock.withLock {
      try operation(entry.integration)
    }
  }

  private func entry(for agent: SupatermAgentKind) -> Entry {
    switch agent {
    case .claude:
      claude
    case .codex:
      codex
    case .pi:
      pi
    }
  }
}
