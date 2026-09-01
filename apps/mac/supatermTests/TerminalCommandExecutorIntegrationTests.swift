import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorIntegrationTests {
  @Test
  func liveManagerUsesIsolatedHomeOnlyInTestMode() {
    let defaultHome = URL(fileURLWithPath: "/Users/tester", isDirectory: true)
    let isolatedHome = URL(fileURLWithPath: "/tmp/supaterm-e2e-home", isDirectory: true)

    #expect(
      CodingAgentIntegrationManager.homeDirectoryURL(
        environment: [
          "SUPATERM_TEST_MODE": "1",
          SupatermCLIEnvironment.testHomeKey: isolatedHome.path,
        ],
        defaultHomeDirectoryURL: defaultHome
      ) == isolatedHome
    )
    #expect(
      CodingAgentIntegrationManager.homeDirectoryURL(
        environment: [SupatermCLIEnvironment.testHomeKey: isolatedHome.path],
        defaultHomeDirectoryURL: defaultHome
      ) == defaultHome
    )
  }

  @Test
  func setupWritesManagedClaudeHooksAndReportsHealth() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .healthy))
    #expect(
      try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == [
        "Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop",
        "SubagentStart", "SubagentStop", "UserPromptSubmit",
      ]
    )
  }

  @Test
  func setupSkipsUnavailableClaude() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL, isAvailable: false)
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .unavailable))
    #expect(
      !FileManager.default.fileExists(
        atPath: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
      )
    )
  }

  @Test
  func setupFailsWithoutOverwritingInvalidClaudeSettings() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let invalidJSON = #"{ "hooks":"#
    try writeClaudeSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    await #expect(throws: ClaudeSettingsInstallerError.invalidJSON) {
      try await commandExecutor.setupAgentIntegration(
        SupatermAgentIntegrationRequest(agent: .claude),
        manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
      )
    }

    #expect(
      try String(
        contentsOf: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL),
        encoding: .utf8
      ) == invalidJSON
    )
  }

  @Test
  func removeDropsManagedClaudeHooksAndKeepsTheRest() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeClaudeSettings(
      """
      {
        "hooks": {
          "Notification": [
            {"hooks": [{"command": "echo keep", "timeout": 30, "type": "command"}]}
          ]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let manager = claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
    _ = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: manager
    )

    let result = try await commandExecutor.removeAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: manager
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .absent))
    #expect(try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == ["Notification"])
  }

  @Test
  func setupAndRemovalForwardTheRequestedAgent() async throws {
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let recorder = AgentIntegrationRecorder()
    let manager = CodingAgentIntegrationManager(
      claude: recordingIntegration(.claude, recorder: recorder),
      codex: recordingIntegration(.codex, recorder: recorder)
    )

    for agent in SupatermManagedAgentKind.allCases {
      _ = try await commandExecutor.setupAgentIntegration(
        SupatermAgentIntegrationRequest(agent: agent),
        manager: manager
      )
      _ = try await commandExecutor.removeAgentIntegration(
        SupatermAgentIntegrationRequest(agent: agent),
        manager: manager
      )
    }

    #expect(recorder.setupAgents() == SupatermManagedAgentKind.allCases)
    #expect(recorder.healthCheckedAgents() == SupatermManagedAgentKind.allCases)
    #expect(recorder.removedAgents() == SupatermManagedAgentKind.allCases)
  }

}

private func claudeIntegrationManager(
  homeDirectoryURL: URL,
  isAvailable: Bool = true
) -> CodingAgentIntegrationManager {
  let makeInstaller: @Sendable () -> ClaudeSettingsInstaller = {
    ClaudeSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runAvailabilityCommand: { CodingAgentCommandResult(status: isAvailable ? 0 : 127) }
    )
  }
  let integration = CodingAgentIntegrationManager.Integration(
    setup: { try makeInstaller().setup() },
    health: { try makeInstaller().integrationHealth() },
    repair: { try makeInstaller().installSupatermHooks() },
    remove: { try makeInstaller().removeSupatermHooks() }
  )
  return CodingAgentIntegrationManager(
    claude: integration,
    codex: integration
  )
}

private func recordingIntegration(
  _ agent: SupatermManagedAgentKind,
  recorder: AgentIntegrationRecorder
) -> CodingAgentIntegrationManager.Integration {
  CodingAgentIntegrationManager.Integration(
    setup: {
      recorder.recordSetup(agent)
      return .healthy
    },
    health: {
      recorder.recordHealthCheck(agent)
      return .absent
    },
    repair: {},
    remove: { recorder.recordRemove(agent) }
  )
}

private func temporaryHookHome() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func writeClaudeSettings(_ contents: String, homeDirectoryURL: URL) throws {
  let settingsURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: settingsURL)
}

private func claudeHookEventNames(homeDirectoryURL: URL) throws -> [String] {
  let data = try Data(
    contentsOf: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  )
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let hooks = try #require(object["hooks"] as? [String: Any])
  return hooks.keys.sorted()
}

nonisolated private final class AgentIntegrationRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var setups: [SupatermManagedAgentKind] = []
  private var healthChecks: [SupatermManagedAgentKind] = []
  private var removes: [SupatermManagedAgentKind] = []

  func recordSetup(_ agent: SupatermManagedAgentKind) {
    lock.lock()
    setups.append(agent)
    lock.unlock()
  }

  func recordHealthCheck(_ agent: SupatermManagedAgentKind) {
    lock.lock()
    healthChecks.append(agent)
    lock.unlock()
  }

  func recordRemove(_ agent: SupatermManagedAgentKind) {
    lock.lock()
    removes.append(agent)
    lock.unlock()
  }

  func setupAgents() -> [SupatermManagedAgentKind] {
    lock.lock()
    let snapshot = setups
    lock.unlock()
    return snapshot
  }

  func removedAgents() -> [SupatermManagedAgentKind] {
    lock.lock()
    let snapshot = removes
    lock.unlock()
    return snapshot
  }

  func healthCheckedAgents() -> [SupatermManagedAgentKind] {
    lock.lock()
    let snapshot = healthChecks
    lock.unlock()
    return snapshot
  }
}
