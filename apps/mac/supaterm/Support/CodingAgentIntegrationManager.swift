import Foundation
import SupatermCLIShared

enum CodingAgentIntegrationManagerError: Error, Equatable, LocalizedError, Sendable {
  case busy(SupatermManagedAgentKind)

  var errorDescription: String? {
    switch self {
    case .busy(let agent):
      return "Supaterm is already working on the \(agent.notificationTitle) integration. Try again in a moment."
    }
  }
}

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
  private let coordinationTimeout: TimeInterval

  init(
    claude: Integration,
    codex: Integration,
    coordinationTimeout: TimeInterval = SupatermAgentIntegrationTiming.coordinationTimeout
  ) {
    self.claude = Entry(integration: claude, lock: NSLock())
    self.codex = Entry(integration: codex, lock: NSLock())
    self.coordinationTimeout = coordinationTimeout
  }

  public func setup(_ agent: SupatermManagedAgentKind) throws -> CodingAgentIntegrationHealth {
    try withIntegration(for: agent) { try $0.setup() }
  }

  public func health(_ agent: SupatermManagedAgentKind) throws -> CodingAgentIntegrationHealth {
    try withIntegration(for: agent) { try $0.health() }
  }

  public func repair(_ agent: SupatermManagedAgentKind) throws {
    try withIntegration(for: agent) { try $0.repair() }
  }

  public func remove(_ agent: SupatermManagedAgentKind) throws -> CodingAgentIntegrationHealth {
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
    for agent: SupatermManagedAgentKind,
    _ operation: (Integration) throws -> Result
  ) throws -> Result {
    let entry = entry(for: agent)
    guard entry.lock.lock(before: Date(timeIntervalSinceNow: coordinationTimeout)) else {
      throw CodingAgentIntegrationManagerError.busy(agent)
    }
    defer { entry.lock.unlock() }
    return try operation(entry.integration)
  }

  private func entry(for agent: SupatermManagedAgentKind) -> Entry {
    switch agent {
    case .claude:
      claude
    case .codex:
      codex
    }
  }
}
